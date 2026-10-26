package api

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"path"
	"strings"
)

// Images inside an uploaded backup archive get the same treatment as a
// normal upload of their kind (M6 §12 fix round 1):
//   - an icon PNG is decoded, resized to fit 128×128 and re-encoded, exactly
//     as handleUploadIcon does;
//   - any other raster image (an icon .jpg/.gif/.webp, every background) has
//     its header decoded (type matches the extension, dimensions bounded) but
//     is not fully decoded or re-encoded, like a normal background upload;
//   - an SVG icon is kept as is, like a normal SVG upload (served with the
//     strict asset CSP, so its script never runs).
//
// Before any decode the dimensions are checked (a small file can claim a
// huge image).

const (
	maxArchiveImageSide   = 16384
	maxArchiveImagePixels = 40_000_000
)

func processArchiveImage(kind, name string, data []byte) ([]byte, error) {
	ext := strings.ToLower(path.Ext(name))
	if ext == ".svg" {
		if kind != "icons" {
			return nil, errors.New("only icons may be SVG")
		}
		return data, nil
	}
	format, err := checkImageHeader(data)
	if err != nil {
		return nil, err
	}
	if !formatMatchesExt(format, ext) {
		return nil, fmt.Errorf("it is a %s image, not what %s says", format, ext)
	}
	if kind != "icons" || ext != ".png" {
		// Not re-encoded (like a normal upload of its kind): the header check
		// above is enough, and a full decode would cost a Pi Zero memory.
		return data, nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("it can't be decoded as an image: %v", err)
	}
	{
		var b bytes.Buffer
		if err := png.Encode(&b, resizeImage(img, 128, 128)); err != nil {
			return nil, fmt.Errorf("it can't be re-encoded: %v", err)
		}
		return b.Bytes(), nil
	}
}

func formatMatchesExt(format, ext string) bool {
	switch ext {
	case ".png":
		return format == "png"
	case ".jpg", ".jpeg":
		return format == "jpeg"
	case ".gif":
		return format == "gif"
	case ".webp":
		return format == "webp"
	}
	return false
}

// checkImageHeader reads only the image header (image.DecodeConfig) and
// refuses a decompression bomb — a small file claiming huge dimensions —
// before anything is fully decoded. Used by the archive path and by the
// normal icon and background uploads (§3 security pass), so both apply the
// same caps. It returns the decoded format name ("png", "jpeg", ...).
func checkImageHeader(data []byte) (string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("it can't be decoded as an image: %v", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return "", fmt.Errorf("its size (%d×%d) is not a valid image size", cfg.Width, cfg.Height)
	}
	if cfg.Width > maxArchiveImageSide || cfg.Height > maxArchiveImageSide ||
		int64(cfg.Width)*int64(cfg.Height) > maxArchiveImagePixels {
		return "", fmt.Errorf("its size (%d×%d) is too large: at most %d pixels per side and %d megapixels",
			cfg.Width, cfg.Height, maxArchiveImageSide, maxArchiveImagePixels/1_000_000)
	}
	return format, nil
}

// formatMatchesContentType says whether a decoded format is what the upload's
// declared Content-Type claims.
func formatMatchesContentType(format, contentType string) bool {
	switch contentType {
	case "image/png":
		return format == "png"
	case "image/jpeg":
		return format == "jpeg"
	case "image/gif":
		return format == "gif"
	case "image/webp":
		return format == "webp"
	}
	return false
}
