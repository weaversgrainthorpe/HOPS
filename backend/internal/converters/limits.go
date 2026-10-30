package converters

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"gopkg.in/yaml.v3"
)

// Imported documents are untrusted: before any import
// decodes a file into Go values, its shape is checked against these caps so a
// deeply nested file, one with millions of tiny values, or a YAML alias bomb
// ("billion laughs") is refused with a clear reason instead of exhausting a
// Pi Zero's memory or stack. The largest real export seen is depth 21 and a
// few thousand values, so both caps leave plenty of room.
const (
	MaxImportDepth = 64
	MaxImportNodes = 250_000
)

// ErrImportTooLarge is wrapped by every CheckImportLimits refusal.
var ErrImportTooLarge = errors.New("the file is too deeply nested or has too many entries to import")

// CheckImportLimits refuses a document deeper than MaxImportDepth or with
// more than MaxImportNodes values. JSON is scanned token by token (nothing is
// built); YAML is parsed to its node tree and walked with every alias
// expanded, so an alias bomb counts as the document it would expand to.
// A file that is neither valid JSON nor YAML passes: the import's own parse
// reports that.
func CheckImportLimits(data []byte) error {
	trimmed := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), " \t\r\n")
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		ok, err := checkJSONLimits(data)
		if err != nil || ok {
			return err
		}
		// Not valid JSON: it may still be YAML in flow style.
	}
	return checkYAMLLimits(data)
}

// checkJSONLimits returns (true, nil) when data is a complete JSON value
// within the caps, (false, nil) when it isn't valid JSON, and an error when a
// cap is exceeded.
func checkJSONLimits(data []byte) (bool, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	depth, nodes := 0, 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return true, nil
		}
		if err != nil {
			return false, nil
		}
		if d, ok := tok.(json.Delim); ok {
			if d == '{' || d == '[' {
				depth++
				nodes++
				if depth > MaxImportDepth {
					return false, fmt.Errorf("%w: it is nested more than %d levels deep", ErrImportTooLarge, MaxImportDepth)
				}
			} else {
				depth--
			}
			continue
		}
		nodes++
		if nodes > MaxImportNodes {
			return false, fmt.Errorf("%w: it has more than %d entries", ErrImportTooLarge, MaxImportNodes)
		}
	}
}

type yamlWalker struct{ nodes int }

func (w *yamlWalker) walk(n *yaml.Node, depth int) error {
	if n == nil {
		return nil
	}
	if depth > MaxImportDepth {
		return fmt.Errorf("%w: it is nested more than %d levels deep (or an alias refers to itself)", ErrImportTooLarge, MaxImportDepth)
	}
	w.nodes++
	if w.nodes > MaxImportNodes {
		return fmt.Errorf("%w: it has more than %d entries once its aliases are expanded", ErrImportTooLarge, MaxImportNodes)
	}
	if n.Kind == yaml.AliasNode {
		// Counted as what it expands to: this is what stops an alias bomb.
		return w.walk(n.Alias, depth+1)
	}
	next := depth
	if n.Kind == yaml.MappingNode || n.Kind == yaml.SequenceNode {
		next = depth + 1
	}
	for _, c := range n.Content {
		if err := w.walk(c, next); err != nil {
			return err
		}
	}
	return nil
}

func checkYAMLLimits(data []byte) error {
	dec := yaml.NewDecoder(bytes.NewReader(data))
	w := &yamlWalker{}
	for {
		var n yaml.Node
		if err := dec.Decode(&n); err != nil {
			if err == io.EOF {
				return nil
			}
			// yaml.v3's own depth limit is a refusal too; any other parse
			// error is left for the import's parse to report.
			if bytes.Contains([]byte(err.Error()), []byte("exceeded max depth")) {
				return fmt.Errorf("%w: it is nested more than %d levels deep", ErrImportTooLarge, MaxImportDepth)
			}
			return nil
		}
		if err := w.walk(&n, 0); err != nil {
			return err
		}
	}
}
