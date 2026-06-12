package api

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"lanshare/store"
	"lanshare/thumb"
)

func msgTypeForMime(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	default:
		return "file"
	}
}

func (s *Server) handleInitUpload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		Mime string `json:"mime"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.Size < 0 {
		writeErr(w, http.StatusBadRequest, "name and non-negative size required")
		return
	}
	if req.Mime == "" {
		req.Mime = "application/octet-stream"
	}
	u, err := s.Store.InitUpload(req.Name, req.Size, req.Mime)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"upload_id":  u.ID,
		"chunk_size": u.ChunkSize,
		"received":   u.Received(),
	})
}

// handlePutChunk streams the raw chunk body straight to disk; nothing is
// buffered in memory regardless of chunk size.
func (s *Server) handlePutChunk(w http.ResponseWriter, r *http.Request) {
	u, err := s.Store.GetUpload(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "upload not found")
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad chunk index")
		return
	}
	if err := s.Store.SaveChunk(u, n, r.Body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCompleteUpload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := s.Store.GetUpload(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "upload not found")
		return
	}
	m, err := s.Store.CompleteUpload(id, msgTypeForMime(u.Mime), r.Header.Get("X-Device-Id"))
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, store.ErrIncomplete) {
			code = http.StatusConflict
		}
		writeErr(w, code, err.Error())
		return
	}
	if m.Type == "image" {
		if err := thumb.Generate(s.Store.FilePath(id), s.Store.ThumbPath(id)); err != nil {
			log.Printf("thumbnail %s: %v", id, err) // 缩略图失败不阻塞消息
		}
	}
	s.Hub.Broadcast(Event{Event: "new_message", Message: m})
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleGetUpload(w http.ResponseWriter, r *http.Request) {
	u, err := s.Store.GetUpload(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "upload not found")
		return
	}
	if u.Bitmap == nil {
		writeJSON(w, http.StatusOK, map[string]any{"received": []int{}, "completed": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": u.Received(), "completed": false})
}
