// Package api wires HTTP handlers around the store. All /api routes require
// Bearer auth; file downloads and the websocket additionally accept ?token=
// so browsers and external downloaders can use plain URLs.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"lanshare/store"
)

type Server struct {
	Store      *store.Store
	Token      string
	MaxStorage int64
	Hub        *Hub

	seenMu   sync.Mutex
	lastSeen map[string]time.Time // device id -> last persisted touch
}

func NewServer(st *store.Store, token string, maxStorage int64) *Server {
	s := &Server{
		Store:      st,
		Token:      token,
		MaxStorage: maxStorage,
		Hub:        NewHub(),
		lastSeen:   map[string]time.Time{},
	}
	go s.Hub.Run()
	return s
}

func (s *Server) Routes(mux *http.ServeMux) {
	auth := s.requireAuth

	mux.HandleFunc("POST /api/devices", auth(s.handleRegisterDevice))
	mux.HandleFunc("GET /api/devices", auth(s.handleListDevices))
	mux.HandleFunc("PATCH /api/devices/{id}", auth(s.handleRenameDevice))
	mux.HandleFunc("DELETE /api/devices/{id}", auth(s.handleDeleteDevice))

	mux.HandleFunc("GET /api/messages", auth(s.handleListMessages))
	mux.HandleFunc("POST /api/messages", auth(s.handlePostMessage))
	mux.HandleFunc("DELETE /api/messages/{id}", auth(s.handleDeleteMessage))

	mux.HandleFunc("POST /api/uploads", auth(s.handleInitUpload))
	mux.HandleFunc("PUT /api/uploads/{id}/chunks/{n}", auth(s.handlePutChunk))
	mux.HandleFunc("POST /api/uploads/{id}/complete", auth(s.handleCompleteUpload))
	mux.HandleFunc("GET /api/uploads/{id}", auth(s.handleGetUpload))

	mux.HandleFunc("GET /api/files/{id}", auth(s.handleFile))
	mux.HandleFunc("GET /api/files/{id}/thumb", auth(s.handleThumb))

	mux.HandleFunc("GET /api/ws", auth(s.handleWS))
	mux.HandleFunc("GET /api/stats", auth(s.handleStats))
}

func (s *Server) authorized(r *http.Request) bool {
	tok := ""
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		tok = strings.TrimPrefix(h, "Bearer ")
	} else {
		tok = r.URL.Query().Get("token")
	}
	return tok != "" && subtle.ConstantTimeCompare([]byte(tok), []byte(s.Token)) == 1
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r) {
			writeErr(w, http.StatusUnauthorized, "invalid token")
			return
		}
		s.touchDevice(r.Header.Get("X-Device-Id"))
		next(w, r)
	}
}

// touchDevice persists last_seen at most once a minute per device to keep
// reads from turning into writes.
func (s *Server) touchDevice(id string) {
	if id == "" {
		return
	}
	s.seenMu.Lock()
	last, ok := s.lastSeen[id]
	if ok && time.Since(last) < time.Minute {
		s.seenMu.Unlock()
		return
	}
	s.lastSeen[id] = time.Now()
	s.seenMu.Unlock()
	if err := s.Store.TouchDevice(id); err != nil {
		log.Printf("touch device %s: %v", id, err)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return false
	}
	return true
}
