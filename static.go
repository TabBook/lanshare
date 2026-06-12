package main

import (
	"io/fs"
	"net/http"
	"strings"

	"lanshare/web"
)

// staticHandler serves the embedded frontend. Assets are precompressed at
// build time (.gz alongside the original); we pick the variant by
// Accept-Encoding instead of compressing at runtime. Hashed assets cache
// forever, entry points never.
func staticHandler() http.Handler {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(dist, p); err != nil {
			p = "index.html" // SPA fallback
		}

		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		if ct := contentType(p); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			if gz, err := fs.ReadFile(dist, p+".gz"); err == nil {
				w.Header().Set("Content-Encoding", "gzip")
				w.Header().Set("Vary", "Accept-Encoding")
				w.Write(gz)
				return
			}
		}
		data, err := fs.ReadFile(dist, p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	})
}

func contentType(p string) string {
	switch {
	case strings.HasSuffix(p, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(p, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(p, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(p, ".png"):
		return "image/png"
	case strings.HasSuffix(p, ".webmanifest"), strings.HasSuffix(p, ".json"):
		return "application/json"
	case strings.HasSuffix(p, ".ico"):
		return "image/x-icon"
	}
	return ""
}
