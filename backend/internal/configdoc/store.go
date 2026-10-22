package configdoc

import (
	"database/sql"
	"encoding/json"
	"errors"
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
	Migrated bool     // true if a v2 doc was converted this start
	Failed   bool     // true if the stored doc could not be migrated
	Detail   string   // human-readable failure reason
	Renames  []Rename // duplicate ids renamed by this start's migration
	// SizeChanges are v2 tiles whose unknown size this start set to Medium
	// (Ruling 3); the router shows them as a one-time notice.
	SizeChanges []SizeChange
}

// MigrateOnStartup converts a stored v2 document to v3. If the stored
// document is already v3 it does nothing. Otherwise, in one transaction, it
// migrates (renaming duplicate ids), verifies against the renames, archives
// the raw row with the renames as notes, clears status rows of renamed tiles
// and saves; each rename is logged at WARN after the commit. Any problem with the
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

	v3, renames, sizes, err := MigrateV2Full(v2)
	if err != nil {
		return failed(fmt.Sprintf("conversion failed: %v", err)), nil
	}
	if err := VerifyMigrationFull(v2, v3, renames, sizes); err != nil {
		return failed(fmt.Sprintf("verification failed: %v", err)), nil
	}

	// The archive row carries the renames so the change is traceable later.
	var notes any // NULL when nothing was renamed
	if len(renames) > 0 {
		b, err := json.Marshal(renames)
		if err != nil {
			return MigrationResult{}, fmt.Errorf("configdoc: encode renames: %w", err)
		}
		notes = string(b)
	}
	if _, err := tx.Exec("INSERT INTO config_archive (schema, data, notes) VALUES (2, ?, ?)", raw, notes); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: archive v2 config: %w", err)
	}

	// A cached status under a duplicated tile id may have come from either
	// tile; drop it (and anything under the new id) so neither tile shows a
	// result that is not its own. The next status check refills both.
	for _, r := range renames {
		if r.Kind != "tile" {
			continue
		}
		if _, err := tx.Exec("DELETE FROM status_cache WHERE entry_id IN (?, ?)", r.OldID, r.NewID); err != nil {
			return MigrationResult{}, fmt.Errorf("configdoc: clear status cache for renamed tile %q: %w", r.OldID, err)
		}
	}

	if err := Save(tx, v3); err != nil {
		return MigrationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MigrationResult{}, fmt.Errorf("configdoc: commit migration: %w", err)
	}
	slog.Info("config migrated from v2 to v3; original archived", "component", "configdoc", "renamed", len(renames))
	for _, r := range renames {
		slog.Warn("renamed duplicate id during config migration", "component", "configdoc",
			"kind", r.Kind, "dashboard", r.DashboardID, "old_id", r.OldID, "new_id", r.NewID, "path", r.Path)
	}
	for _, sc := range sizes {
		slog.Warn("tile size not recognised during config migration; set to medium", "component", "configdoc",
			"dashboard", sc.DashboardID, "tile", sc.TileID, "name", sc.TileName, "old_size", show(sc.OldSize), "path", sc.Path)
	}
	return MigrationResult{Migrated: true, Renames: renames, SizeChanges: sizes}, nil
}

func failed(detail string) MigrationResult {
	slog.Error("config v2→v3 migration FAILED; stored config left untouched", "component", "configdoc", "detail", detail)
	return MigrationResult{Failed: true, Detail: detail}
}

// MigrateWithBackup runs MigrateOnStartup, but when the stored document is
// still v2 it first calls backup synchronously so the safety backup holds the
// pre-migration data. If that backup fails the migration is NOT attempted and
// a Failed result is returned. backedUp reports whether backup was called
// (and succeeded); when false the caller may take its backup asynchronously.
//
// v2→v3 is the only conversion (M5 spec §2a): the converter writes the
// current layout form directly. A stored v3 document at any other
// layoutVersion (a pre-release v3 build's data) is never served as if it were
// current: the result is Failed, naming the versions, and nothing is written.
func MigrateWithBackup(db *sql.DB, backup func() error) (res MigrationResult, backedUp bool, err error) {
	if _, lerr := Load(db); errors.Is(lerr, ErrNotV3) {
		if berr := backup(); berr != nil {
			return failed(fmt.Sprintf("pre-migration backup failed: %v", berr)), false, nil
		}
		backedUp = true
	}
	res, err = MigrateOnStartup(db)
	if err != nil || res.Failed {
		return res, backedUp, err
	}
	doc, lerr := Load(db)
	if lerr != nil {
		return res, backedUp, lerr
	}
	if verr := CheckLayoutVersion(doc); verr != nil {
		detail := "stored config is not in this build's layout form: " + verr.Error() +
			". Pre-release v3 data has no update path; move the database aside and import a v2 export instead."
		slog.Error("stored config layout version mismatch; stored config left untouched", "component", "configdoc", "detail", detail)
		return MigrationResult{Failed: true, Detail: detail}, backedUp, nil
	}
	return res, backedUp, nil
}
