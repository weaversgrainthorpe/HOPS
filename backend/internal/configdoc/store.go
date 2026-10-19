package configdoc

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
)

// Querier is satisfied by *sql.DB and *sql.Tx.
type Querier interface{ QueryRow(string, ...any) *sql.Row }

// Execer is satisfied by *sql.DB and *sql.Tx.
type Execer interface {
	Exec(string, ...any) (sql.Result, error)
}

// Load reads the stored config document. It returns ErrNotV3 if the stored
// document is not schemaVersion 3, and wraps JSON errors.
func Load(q Querier) (Obj, error) {
	var raw string
	if err := q.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&raw); err != nil {
		return nil, fmt.Errorf("configdoc: read config row: %w", err)
	}
	var doc Obj
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("configdoc: stored config is not valid JSON: %w", err)
	}
	if !IsV3(doc) {
		return nil, ErrNotV3
	}
	return doc, nil
}

// Save stamps schemaVersion=3 on doc and writes the config row.
func Save(e Execer, doc Obj) error {
	doc["schemaVersion"] = SchemaVersion
	b, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("configdoc: marshal config: %w", err)
	}
	if _, err := e.Exec(
		"INSERT OR REPLACE INTO config (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)",
		string(b),
	); err != nil {
		return fmt.Errorf("configdoc: write config row: %w", err)
	}
	return nil
}

// MigrationResult describes what MigrateOnStartup did.
type MigrationResult struct {
	Migrated bool   // true if a v2 doc was converted this start
	Failed   bool   // true if the stored doc could not be migrated
	Detail   string // human-readable failure reason
}

// MigrateOnStartup converts a stored v2 document to v3. If the stored
// document is already v3 it does nothing. Otherwise, in one transaction, it
// archives the raw row, migrates, verifies and saves. Any problem with the
// document rolls everything back (archive included) and is reported as
// Failed with a Detail; only DB-level errors are returned as Go errors.
func MigrateOnStartup(db *sql.DB) (MigrationResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: begin migration: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after Commit

	var raw string
	if err := tx.QueryRow("SELECT data FROM config WHERE id = 1").Scan(&raw); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: read config row: %w", err)
	}

	var v2 Obj
	if err := json.Unmarshal([]byte(raw), &v2); err != nil {
		return failed(fmt.Sprintf("stored config is not valid JSON: %v", err)), nil
	}
	if IsV3(v2) {
		return MigrationResult{}, nil
	}

	if _, err := tx.Exec("INSERT INTO config_archive (schema, data) VALUES (2, ?)", raw); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: archive v2 config: %w", err)
	}

	v3, err := MigrateV2(v2)
	if err != nil {
		return failed(fmt.Sprintf("conversion failed: %v", err)), nil
	}
	if err := Verify(v2, v3); err != nil {
		return failed(fmt.Sprintf("verification failed: %v", err)), nil
	}
	if err := Save(tx, v3); err != nil {
		return MigrationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: commit migration: %w", err)
	}
	slog.Info("config migrated from v2 to v3; original archived", "component", "configdoc")
	return MigrationResult{Migrated: true}, nil
}

func failed(detail string) MigrationResult {
	slog.Error("config v2→v3 migration FAILED; stored config left untouched", "component", "configdoc", "detail", detail)
	return MigrationResult{Failed: true, Detail: detail}
}
