package api

import (
	"net/http"
	"net/url"
	"os"
	"time"
)

// handleFile serves the original blob via http.ServeContent, which provides
// Range (video seeking, resumable & multi-threaded downloads), ETag and
// If-Modified-Since for free. File ids are immutable, so clients may cache
// forever.
func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := s.Store.GetUpload(id)
	if err != nil || u.Bitmap != nil {
		writeErr(w, http.StatusNotFound, "file not found")
		return
	}
	f, err := os.Open(s.Store.FilePath(id))
	if err != nil {
		writeErr(w, http.StatusNotFound, "file not found")
		return
	}
	defer f.Close()

	disp := "inline"
	if r.URL.Query().Get("dl") == "1" {
		disp = "attachment"
	}
	// RFC 5987 filename* keeps non-ASCII names (中文) intact.
	w.Header().Set("Content-Disposition", disp+`; filename*=UTF-8''`+url.PathEscape(u.Name))
	w.Header().Set("Content-Type", u.Mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+id+`"`)
	http.ServeContent(w, r, "", time.UnixMilli(u.CreatedAt), f)
}

func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Store.GetUpload(id); err != nil {
		writeErr(w, http.StatusNotFound, "file not found")
		return
	}
	f, err := os.Open(s.Store.ThumbPath(id))
	if err != nil {
		writeErr(w, http.StatusNotFound, "no thumbnail")
		return
	}
	defer f.Close()
	fi, _ := f.Stat()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", `"t-`+id+`"`)
	http.ServeContent(w, r, "", fi.ModTime(), f)
}
