package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/weaversgrainthorpe/HOPS/internal/configdoc"
)

// Settings › Icons: managing the uploaded icons and the user's icon
// categories. The usage ("where used") is computed from the stored layout on
// every request, never cached, so it can't go stale; when the layout can't be
// read the answer is an error, never "unused".

// maxIconNameLen bounds icon and category names (characters).
const maxIconNameLen = 100

var (
	// An uploaded icon's URL: a plain file name under /icons/ (what uploads
	// produce), never a path, a hidden file or another origin.
	iconImageURLPattern = regexp.MustCompile(`^/icons/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$`)
	// An Iconify name, prefix:name, lower case.
	iconifyNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,49}:[a-z0-9][a-z0-9_-]{0,99}$`)
	// A colour: #rgb, #rgba, #rrggbb or #rrggbbaa.
	iconColorPattern = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)
	// An icon id as it appears in /api/icons/{id}.
	iconIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
)

// Ids that would collide with the fixed /api/icons/... routes.
var reservedIconIDs = map[string]bool{"usage": true, "upload": true, "dashboard": true, "packaged": true}

func validIconImageURL(u string) bool {
	return iconImageURLPattern.MatchString(u) && !strings.Contains(u, "..")
}

// checkIconFields validates an Iconify name and a colour ("" = none).
func checkIconFields(icon, color string) error {
	if icon != "" && !iconifyNamePattern.MatchString(icon) {
		return fmt.Errorf("%q isn't an icon name (use prefix:name, e.g. mdi:server)", icon)
	}
	if color != "" && !iconColorPattern.MatchString(color) {
		return fmt.Errorf("%q isn't a colour (use #rgb or #rrggbb)", color)
	}
	return nil
}

// iconUse is one place that shows an image: a tile, folder, tab or dashboard.
type iconUse struct {
	Kind        string `json:"kind"` // tile | folder | tab | dashboard
	Name        string `json:"name"`
	DashboardID string `json:"dashboardId"`
	Dashboard   string `json:"dashboard"`
	Tab         string `json:"tab,omitempty"`
	// Folder is the innermost folder holding a tile or folder, if any.
	Folder string `json:"folder,omitempty"`
}

// iconUsageByURL walks a v3 document and returns, for each image URL, the
// places that use it as their icon (iconUrl), in document order.
func iconUsageByURL(doc configdoc.Obj) map[string][]iconUse {
	out := map[string][]iconUse{}
	str := func(o configdoc.Obj, k string) string { s, _ := o[k].(string); return s }
	dashes, _ := doc["dashboards"].([]any)
	for _, d := range dashes {
		dash, _ := d.(configdoc.Obj)
		if dash == nil {
			continue
		}
		dashName, dashID := str(dash, "name"), str(dash, "id")
		if u := str(dash, "iconUrl"); u != "" {
			out[u] = append(out[u], iconUse{Kind: "dashboard", Name: dashName, DashboardID: dashID, Dashboard: dashName})
		}
		tabs, _ := dash["tabs"].([]any)
		for _, t := range tabs {
			tab, _ := t.(configdoc.Obj)
			if tab == nil {
				continue
			}
			if u := str(tab, "iconUrl"); u != "" {
				out[u] = append(out[u], iconUse{Kind: "tab", Name: str(tab, "name"), DashboardID: dashID, Dashboard: dashName, Tab: str(tab, "name")})
			}
		}
	}
	configdoc.Walk(doc, func(dash, tab configdoc.Obj, path []configdoc.Obj, node configdoc.Obj) bool {
		u := str(node, "iconUrl")
		if u == "" {
			return true
		}
		kind := "tile"
		if node["kind"] == "folder" {
			kind = "folder"
		}
		use := iconUse{Kind: kind, Name: str(node, "name"), DashboardID: str(dash, "id"), Dashboard: str(dash, "name"), Tab: str(tab, "name")}
		if len(path) > 0 {
			use.Folder = str(path[len(path)-1], "name")
		}
		out[u] = append(out[u], use)
		return true
	})
	return out
}

// loadIconUsage reads the stored layout and computes its usage map.
func (r *Router) loadIconUsage() (map[string][]iconUse, error) {
	doc, err := configdoc.Load(r.db)
	if err != nil {
		return nil, err
	}
	return iconUsageByURL(doc), nil
}

// handleIconUsage: GET /api/icons/usage (admin). For every uploaded icon
// (not built-in, with an image), the places that use it; an unused icon has
// an empty list. "packaged" covers the packaged icons. Not cached.
func (r *Router) handleIconUsage(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	doc, err := configdoc.Load(r.db)
	if err != nil {
		slog.Error("icon usage: could not read the layout", "component", "icons", "error", err)
		writeJSONError(w, "Couldn't read the dashboards to work out where icons are used: "+err.Error(), http.StatusInternalServerError)
		return
	}
	usage := iconUsageByURL(doc)
	rows, err := r.db.Query(`SELECT id, image_url FROM icons WHERE is_preset = 0 AND image_url IS NOT NULL AND image_url != '' LIMIT 10000`)
	if err != nil {
		writeJSONError(w, "Failed to load icons", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	icons := map[string][]iconUse{}
	for rows.Next() {
		var id, img string
		if err := rows.Scan(&id, &img); err != nil {
			writeJSONError(w, "Failed to read icons", http.StatusInternalServerError)
			return
		}
		uses := usage[img]
		if uses == nil {
			uses = []iconUse{}
		}
		icons[id] = uses
	}
	if err := rows.Err(); err != nil {
		writeJSONError(w, "Failed to read icons", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	// "packaged": where the packaged icons are used (icons_packaged.go).
	writeJSON(w, map[string]any{"fetchedAt": time.Now().UTC().Format(time.RFC3339), "icons": icons, "packaged": packagedIconUsage(doc, usage)})
}

// cleanDisplayName trims a user-typed icon/category name and checks it: not
// empty, at most maxIconNameLen characters, no control characters. Names are
// stored and shown as text only.
func cleanDisplayName(s, what string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("%s name can't be empty", what)
	}
	if !utf8.ValidString(s) {
		return "", fmt.Errorf("%s name is not valid text", what)
	}
	if utf8.RuneCountInString(s) > maxIconNameLen {
		return "", fmt.Errorf("%s name is too long (at most %d characters)", what, maxIconNameLen)
	}
	for _, c := range s {
		if unicode.IsControl(c) {
			return "", fmt.Errorf("%s name can't contain control characters", what)
		}
	}
	return s, nil
}

func (r *Router) categoryExists(q interface {
	QueryRow(string, ...any) *sql.Row
}, id string) (bool, error) {
	var n int
	if err := q.QueryRow(`SELECT COUNT(*) FROM icon_categories WHERE id = ?`, id).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// iconFilePath maps an uploaded icon's URL (/icons/<file>) to its file in the
// data directory, or "" when the URL is not a plain uploaded-icon path.
func (r *Router) iconFilePath(imageURL string) string {
	if !validIconImageURL(imageURL) {
		return ""
	}
	return filepath.Join(r.config.DataDir, "icons", strings.TrimPrefix(imageURL, "/icons/"))
}

// handleCreateIcon: POST /api/icons (admin). The same checks as uploads and
// edits: a valid id and name, an existing category, an uploaded-icon URL or
// an Iconify name, and a valid colour.
func (r *Router) handleCreateIcon(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		Icon       string  `json:"icon"`
		CategoryID string  `json:"categoryId"`
		Color      *string `json:"color"`
		ImageURL   *string `json:"imageUrl"`
	}
	if err := decodeJSONBody(req, &body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if !iconIDPattern.MatchString(body.ID) || reservedIconIDs[body.ID] {
		writeJSONError(w, "Missing or invalid icon id", http.StatusBadRequest)
		return
	}
	name, err := cleanDisplayName(body.Name, "The icon")
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	color, img := "", ""
	if body.Color != nil {
		color = *body.Color
	}
	if body.ImageURL != nil {
		img = *body.ImageURL
	}
	if err := checkIconFields(body.Icon, color); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if img != "" && !validIconImageURL(img) {
		writeJSONError(w, "The image must be an uploaded icon (/icons/<file>)", http.StatusBadRequest)
		return
	}
	if body.Icon == "" && img == "" {
		writeJSONError(w, "Either icon or imageUrl is required", http.StatusBadRequest)
		return
	}
	if ok, err := r.categoryExists(r.db, body.CategoryID); err != nil {
		writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
		return
	} else if !ok {
		writeJSONError(w, "That category doesn't exist", http.StatusBadRequest)
		return
	}
	var n int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM icons WHERE id = ?`, body.ID).Scan(&n); err != nil {
		writeJSONError(w, "Failed to check the icon", http.StatusInternalServerError)
		return
	} else if n > 0 {
		writeJSONError(w, "An icon with that id already exists", http.StatusConflict)
		return
	}
	nullable := func(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }
	if _, err := r.db.Exec(
		"INSERT INTO icons (id, name, icon, category_id, color, image_url, is_preset) VALUES (?, ?, ?, ?, ?, ?, 0)",
		body.ID, name, body.Icon, body.CategoryID, nullable(color), nullable(img),
	); err != nil {
		writeJSONError(w, "Failed to create icon", http.StatusInternalServerError)
		return
	}
	writeJSONSuccess(w)
}

// handleUpdateIcon: PUT /api/icons/{id} (admin). Fields that are sent are
// changed (name, categoryId, icon, color); others are kept.
func (r *Router) handleUpdateIcon(w http.ResponseWriter, req *http.Request) {
	iconID := strings.TrimPrefix(req.URL.Path, "/api/icons/")
	if iconID == "" {
		writeJSONError(w, "Icon ID required", http.StatusBadRequest)
		return
	}
	var body struct {
		Name       *string `json:"name"`
		Icon       *string `json:"icon"`
		CategoryID *string `json:"categoryId"`
		Color      *string `json:"color"`
	}
	if err := decodeJSONBody(req, &body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	var name, icon, cat string
	var color sql.NullString
	var preset bool
	err := r.db.QueryRow(`SELECT name, icon, category_id, color, is_preset FROM icons WHERE id = ?`, iconID).Scan(&name, &icon, &cat, &color, &preset)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSONError(w, "That icon no longer exists", http.StatusNotFound)
		return
	} else if err != nil {
		writeJSONError(w, "Failed to load the icon", http.StatusInternalServerError)
		return
	}
	if preset {
		writeJSONError(w, "Built-in icons can't be changed", http.StatusBadRequest)
		return
	}
	newIcon, newColor := "", ""
	if body.Icon != nil {
		newIcon = *body.Icon
	}
	if body.Color != nil {
		newColor = *body.Color
	}
	if err := checkIconFields(newIcon, newColor); err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Name != nil {
		n, err := cleanDisplayName(*body.Name, "The icon")
		if err != nil {
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		name = n
	}
	if body.CategoryID != nil {
		ok, err := r.categoryExists(r.db, *body.CategoryID)
		if err != nil {
			writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
			return
		}
		if !ok {
			writeJSONError(w, "That category doesn't exist", http.StatusBadRequest)
			return
		}
		cat = *body.CategoryID
	}
	if body.Icon != nil {
		icon = *body.Icon
	}
	if body.Color != nil {
		color = sql.NullString{String: *body.Color, Valid: *body.Color != ""}
	}
	if _, err := r.db.Exec(`UPDATE icons SET name = ?, icon = ?, category_id = ?, color = ? WHERE id = ?`,
		name, icon, cat, color, iconID); err != nil {
		writeJSONError(w, "Failed to update icon", http.StatusInternalServerError)
		return
	}
	writeJSONSuccess(w)
}

// handleDeleteIcon: DELETE /api/icons/{id}[?force=1] (admin). Built-in icons
// can't be deleted. An icon that the layout uses is refused with 409 and the
// list of places unless force=1 (the user saw that list and confirmed). The
// uploaded file moves to the attic (kept while a backup refers to it), unless
// another icon row points at it.
func (r *Router) handleDeleteIcon(w http.ResponseWriter, req *http.Request) {
	iconID := strings.TrimPrefix(req.URL.Path, "/api/icons/")
	if iconID == "" {
		writeJSONError(w, "Icon ID required", http.StatusBadRequest)
		return
	}
	var name string
	var img sql.NullString
	var preset bool
	err := r.db.QueryRow(`SELECT name, image_url, is_preset FROM icons WHERE id = ?`, iconID).Scan(&name, &img, &preset)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSONError(w, "That icon no longer exists", http.StatusNotFound)
		return
	} else if err != nil {
		writeJSONError(w, "Failed to load the icon", http.StatusInternalServerError)
		return
	}
	if preset {
		writeJSONError(w, "Built-in icons can't be deleted", http.StatusBadRequest)
		return
	}

	if img.Valid && img.String != "" {
		usage, err := r.loadIconUsage()
		if err != nil {
			writeJSONError(w, "Couldn't check where this icon is used, so it was not deleted: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if uses := usage[img.String]; len(uses) > 0 && req.URL.Query().Get("force") != "1" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			writeJSONBody(w, map[string]any{
				"error":  fmt.Sprintf("This icon is in use in %d place%s; deleting it would break those images.", len(uses), plural(len(uses))),
				"status": http.StatusConflict,
				"usage":  uses,
			})
			return
		}
	}

	// The file goes too, unless another icon row shares it. It MOVES to the
	// attic (M6 §12: a backup may still refer to it) before the row is
	// deleted, and comes back if the row can't be deleted, so a failure never
	// leaves a row whose file is gone.
	file := ""
	if img.Valid {
		var others int
		if err := r.db.QueryRow(`SELECT COUNT(*) FROM icons WHERE image_url = ? AND id != ?`, img.String, iconID).Scan(&others); err != nil {
			writeJSONError(w, "Failed to check the icon file", http.StatusInternalServerError)
			return
		}
		if others == 0 && r.iconFilePath(img.String) != "" {
			file = strings.TrimPrefix(img.String, "/icons/")
		}
	}
	moved, movedSum := false, ""
	if file != "" {
		if sum, err := r.backupManager.MoveToAttic("icons", file); err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				slog.Error("icon delete: could not move the file to the attic", "component", "icons", "file", file, "error", err)
				writeJSONError(w, "Couldn't move the icon's file aside, so it was not deleted: "+err.Error(), http.StatusInternalServerError)
				return
			}
		} else {
			moved, movedSum = true, sum
		}
	}
	if _, err := r.db.Exec(`DELETE FROM icons WHERE id = ? AND is_preset = 0`, iconID); err != nil {
		msg := "Failed to delete icon"
		if moved {
			if rerr := r.backupManager.RestoreFromAttic("icons", file, movedSum); rerr != nil {
				slog.Error("icon delete: could not put the file back", "component", "icons", "file", file, "error", rerr)
				msg += "; its file is in " + filepath.Join(r.backupManager.AtticDir(), "icons") + " and couldn't be put back (" + rerr.Error() + ")"
			}
		}
		writeJSONError(w, msg, http.StatusInternalServerError)
		return
	}
	slog.Info("icon deleted", "component", "icons", "id", iconID)
	writeJSONSuccess(w)
}

// handleCreateIconCategory: POST /api/icon-categories (admin).
func (r *Router) handleCreateIconCategory(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Order int    `json:"order"`
	}
	if err := decodeJSONBody(req, &body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if body.ID == "" || body.Icon == "" || len(body.ID) > 100 || strings.ContainsAny(body.ID, "/?#\\ ") {
		writeJSONError(w, "Missing or invalid id or icon", http.StatusBadRequest)
		return
	}
	name, err := cleanDisplayName(body.Name, "The category")
	if err != nil {
		writeJSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if exists, err := r.categoryExists(r.db, body.ID); err != nil {
		writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
		return
	} else if exists {
		writeJSONError(w, "A category with that id already exists", http.StatusConflict)
		return
	}
	if taken, err := r.categoryNameTaken(name, ""); err != nil {
		writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
		return
	} else if taken {
		writeJSONError(w, fmt.Sprintf("There is already a category called %q", name), http.StatusConflict)
		return
	}
	if _, err := r.db.Exec(`INSERT INTO icon_categories (id, name, icon, order_num, is_preset) VALUES (?, ?, ?, ?, 0)`,
		body.ID, name, body.Icon, body.Order); err != nil {
		writeJSONError(w, "Failed to create category", http.StatusInternalServerError)
		return
	}
	writeJSONSuccess(w)
}

func (r *Router) categoryNameTaken(name, exceptID string) (bool, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM icon_categories WHERE lower(name) = lower(?) AND id != ?`, name, exceptID).Scan(&n)
	return n > 0, err
}

// loadUserCategory reads a category for a change; it writes the error (404
// missing, 400 built-in) and returns false when the change can't go ahead.
func (r *Router) loadUserCategory(w http.ResponseWriter, id, verb string) (icon string, order int, ok bool) {
	var preset bool
	err := r.db.QueryRow(`SELECT icon, order_num, is_preset FROM icon_categories WHERE id = ?`, id).Scan(&icon, &order, &preset)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSONError(w, "That category no longer exists", http.StatusNotFound)
		return "", 0, false
	} else if err != nil {
		writeJSONError(w, "Failed to load the category", http.StatusInternalServerError)
		return "", 0, false
	}
	if preset {
		writeJSONError(w, "Built-in categories can't be "+verb, http.StatusBadRequest)
		return "", 0, false
	}
	return icon, order, true
}

// handleUpdateIconCategory: PUT /api/icon-categories/{id} (admin; the user's
// own categories only). Fields that are sent are changed.
func (r *Router) handleUpdateIconCategory(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/api/icon-categories/")
	if id == "" {
		writeJSONError(w, "Category ID required", http.StatusBadRequest)
		return
	}
	var body struct {
		Name  *string `json:"name"`
		Icon  *string `json:"icon"`
		Order *int    `json:"order"`
	}
	if err := decodeJSONBody(req, &body); err != nil {
		writeJSONError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	icon, order, ok := r.loadUserCategory(w, id, "renamed")
	if !ok {
		return
	}
	var name string
	if err := r.db.QueryRow(`SELECT name FROM icon_categories WHERE id = ?`, id).Scan(&name); err != nil {
		writeJSONError(w, "Failed to load the category", http.StatusInternalServerError)
		return
	}
	if body.Name != nil {
		n, err := cleanDisplayName(*body.Name, "The category")
		if err != nil {
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		if taken, err := r.categoryNameTaken(n, id); err != nil {
			writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
			return
		} else if taken {
			writeJSONError(w, fmt.Sprintf("There is already a category called %q", n), http.StatusConflict)
			return
		}
		name = n
	}
	if body.Icon != nil && *body.Icon != "" {
		icon = *body.Icon
	}
	if body.Order != nil {
		order = *body.Order
	}
	if _, err := r.db.Exec(`UPDATE icon_categories SET name = ?, icon = ?, order_num = ? WHERE id = ?`, name, icon, order, id); err != nil {
		writeJSONError(w, "Failed to update category", http.StatusInternalServerError)
		return
	}
	writeJSONSuccess(w)
}

// handleDeleteIconCategory: DELETE /api/icon-categories/{id}[?moveTo=other]
// (admin; the user's own categories only). A category with icons is refused
// with 409 and its icon count unless moveTo names another category; then its
// icons move there and the category goes, in one transaction. Icons are never
// deleted with their category.
func (r *Router) handleDeleteIconCategory(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/api/icon-categories/")
	if id == "" {
		writeJSONError(w, "Category ID required", http.StatusBadRequest)
		return
	}
	if _, _, ok := r.loadUserCategory(w, id, "deleted"); !ok {
		return
	}
	moveTo := req.URL.Query().Get("moveTo")
	if moveTo != "" {
		if moveTo == id {
			writeJSONError(w, "Choose a different category for its icons", http.StatusBadRequest)
			return
		}
		if ok, err := r.categoryExists(r.db, moveTo); err != nil {
			writeJSONError(w, "Failed to check the category", http.StatusInternalServerError)
			return
		} else if !ok {
			writeJSONError(w, "The category chosen for its icons doesn't exist", http.StatusBadRequest)
			return
		}
	}
	tx, err := r.db.Begin()
	if err != nil {
		writeJSONError(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM icons WHERE category_id = ?`, id).Scan(&count); err != nil {
		writeJSONError(w, "Failed to count the category's icons", http.StatusInternalServerError)
		return
	}
	if count > 0 && moveTo == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		writeJSONBody(w, map[string]any{
			"error":     fmt.Sprintf("This category has %d icon%s; choose where they go before deleting it.", count, plural(count)),
			"status":    http.StatusConflict,
			"iconCount": count,
		})
		return
	}
	moved := int64(0)
	if count > 0 {
		res, err := tx.Exec(`UPDATE icons SET category_id = ? WHERE category_id = ?`, moveTo, id)
		if err != nil {
			writeJSONError(w, "Failed to move the category's icons", http.StatusInternalServerError)
			return
		}
		moved, _ = res.RowsAffected()
	}
	if _, err := tx.Exec(`DELETE FROM icon_categories WHERE id = ? AND is_preset = 0`, id); err != nil {
		writeJSONError(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSONError(w, "Failed to delete category", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"success": true, "moved": moved})
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// decodeJSONBody decodes a small JSON request body (at most 64 KiB).
func decodeJSONBody(req *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(req.Body, 64<<10)).Decode(v)
}

// writeJSONBody encodes v after the caller has written the status.
func writeJSONBody(w http.ResponseWriter, v any) {
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// leftoverState holds icon files that were deleted but couldn't be removed
// from disk (path → reason).
type leftoverState struct {
	mu    sync.Mutex
	files map[string]string
}

func (s *leftoverState) add(path string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.files == nil {
		s.files = map[string]string{}
	}
	s.files[path] = err.Error()
}

// retry tries each leftover again and returns those that remain, sorted.
func (s *leftoverState) retry() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for path, reason := range s.files {
		err := os.Remove(path)
		if err == nil || errors.Is(err, os.ErrNotExist) {
			delete(s.files, path)
			continue
		}
		s.files[path] = err.Error()
		out = append(out, fmt.Sprintf("%s (%s)", filepath.Base(path), reason))
	}
	sort.Strings(out)
	return out
}

// sweepIconLeftovers removes "*.deleting" files that an interrupted icon
// delete left in <data>/icons; any it can't remove become an admin notice.
func (r *Router) sweepIconLeftovers() {
	dir := filepath.Join(r.config.DataDir, "icons")
	matches, err := filepath.Glob(filepath.Join(dir, "*.deleting"))
	if err != nil {
		return
	}
	for _, m := range matches {
		if err := os.Remove(m); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("icons: could not remove a leftover from an interrupted delete", "component", "icons", "path", m, "error", err)
			r.iconLeftovers.add(m, err)
		} else if err == nil {
			slog.Info("icons: removed a leftover from an interrupted delete", "component", "icons", "path", m)
		}
	}
}

// iconLeftoverNotice is the sticky admin notice for icon files that couldn't
// be removed, if any remain.
func (r *Router) iconLeftoverNotice() (notice, bool) {
	left := r.iconLeftovers.retry()
	if len(left) == 0 {
		return notice{}, false
	}
	return notice{
		ID: "icon-leftover-files",
		Text: fmt.Sprintf("HOPS couldn't remove %d deleted icon file%s from %s: %s. Delete %s by hand, or check that HOPS can write to that folder; "+
			"HOPS tries again each time this page loads.", len(left), plural(len(left)), filepath.Join(r.config.DataDir, "icons"),
			strings.Join(left, ", "), map[bool]string{true: "it", false: "them"}[len(left) == 1]),
		Level:  "warning",
		Sticky: true,
	}, true
}
