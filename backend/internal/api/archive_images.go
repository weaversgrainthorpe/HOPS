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
// normal upload of their kind:
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

	// Raster icons are fully decoded (then shrunk to 128×128), so they get a
	// much smaller cap than backgrounds, which are never decoded. 2048×2048
	// is 16× the 128 px the icon is stored at, more
	// than any real icon source needs, and its worst-case decode (16-bit
	// RGBA, 8 bytes/pixel) is 32 MiB, which a Pi Zero (512 MB) can afford;
	// the old 40 MP cap allowed about 320 MB.
	maxIconImageSide   = 2048
	maxIconImagePixels = maxIconImageSide * maxIconImageSide
)

// iconDecodeSem lets one icon be decoded at a time, so parallel uploads
// (multi-upload, an import with many icons) can't multiply the peak memory.
var iconDecodeSem = make(chan struct{}, 1)

// checkIconHeader is checkImageHeader with the icon caps. It reads only the
// header, so an over-cap icon is refused before anything is decoded.
func checkIconHeader(data []byte) (string, error) {
	return checkImageHeaderMax(data, maxIconImageSide, maxIconImagePixels)
}

// decodeIconPNG decodes a raster icon whose header checkIconHeader has
// accepted, shrinks it to fit 128×128 and returns it as PNG. Decodes are
// serialised (iconDecodeSem), so peak memory stays bounded by one icon.
func decodeIconPNG(data []byte) ([]byte, error) {
	iconDecodeSem <- struct{}{}
	defer func() { <-iconDecodeSem }()
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("it can't be decoded as an image: %v", err)
	}
	var b bytes.Buffer
	if err := png.Encode(&b, resizeImage(img, 128, 128)); err != nil {
		return nil, fmt.Errorf("it can't be re-encoded: %v", err)
	}
	return b.Bytes(), nil
}

func processArchiveImage(kind, name string, data []byte) ([]byte, error) {
	ext := strings.ToLower(path.Ext(name))
	if ext == ".svg" {
		if kind != "icons" {
			return nil, errors.New("only icons may be SVG")
		}
		return data, nil
	}
	check := checkImageHeader
	if kind == "icons" {
		check = checkIconHeader
	}
	format, err := check(data)
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
	return decodeIconPNG(data)
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
// normal icon and background uploads, so both apply the
// same caps. It returns the decoded format name ("png", "jpeg", ...).
func checkImageHeader(data []byte) (string, error) {
	return checkImageHeaderMax(data, maxArchiveImageSide, maxArchiveImagePixels)
}

func checkImageHeaderMax(data []byte, maxSide, maxPixels int) (string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("it can't be decoded as an image: %v", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return "", fmt.Errorf("its size (%d×%d) is not a valid image size", cfg.Width, cfg.Height)
	}
	if cfg.Width > maxSide || cfg.Height > maxSide ||
		int64(cfg.Width)*int64(cfg.Height) > int64(maxPixels) {
		return "", fmt.Errorf("its size (%d×%d) is too large: at most %d pixels per side and %.1f megapixels",
			cfg.Width, cfg.Height, maxSide, float64(maxPixels)/1_000_000)
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
