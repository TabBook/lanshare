// Package thumb renders JPEG thumbnails (longest side 400px) for images.
// Videos get no thumbnail by design; the frontend shows a play placeholder.
package thumb

import (
	"fmt"
	"image"
	"image/jpeg"
	_ "image/gif"
	_ "image/png"
	"os"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const maxSide = 400

// maxPixels guards decode against decompression bombs (~100MP).
const maxPixels = 100 << 20

func Generate(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return fmt.Errorf("decode config: %w", err)
	}
	if cfg.Width*cfg.Height > maxPixels {
		return fmt.Errorf("image too large: %dx%d", cfg.Width, cfg.Height)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return err
	}
	img, _, err := image.Decode(f)
	if err != nil {
		return fmt.Errorf("decode: %w", err)
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > maxSide || h > maxSide {
		if w >= h {
			h = h * maxSide / w
			w = maxSide
		} else {
			w = w * maxSide / h
			h = maxSide
		}
		if w < 1 {
			w = 1
		}
		if h < 1 {
			h = 1
		}
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.ApproxBiLinear.Scale(out, out.Bounds(), img, b, draw.Src, nil)

	tmp := dst + ".part"
	o, err := os.Create(tmp)
	if err != nil {
		return err
	}
	err = jpeg.Encode(o, out, &jpeg.Options{Quality: 80})
	if cerr := o.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
