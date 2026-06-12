package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"lanshare/store"
)

func expandTypes(t string) []string {
	switch t {
	case "image":
		return []string{"image", "video"} // 图片视图含视频
	case "file":
		return []string{"file"}
	case "text":
		return []string{"text"}
	default:
		return nil
	}
}

func parseLimit(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 || n > 200 {
		return 50
	}
	return n
}

// handleListMessages serves the timeline. Modes:
//   - ?before=<id>  descending page (default entry: before omitted = newest)
//   - ?after=<id>   ascending page
//   - ?anchor=YYYY-MM-DD or ?anchor=<message-id>  window around the anchor,
//     returned ascending with anchor_id for client cursors/highlight
//
// ?q= and ?type= compose with all modes.
func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	types := expandTypes(q.Get("type"))
	limit := parseLimit(r)
	search := strings.TrimSpace(q.Get("q"))

	list := func(opts store.ListOptions) ([]store.Message, error) {
		opts.Types = types
		if search != "" {
			return s.Store.SearchMessages(search, opts)
		}
		return s.Store.ListMessages(opts)
	}

	if anchor := q.Get("anchor"); anchor != "" {
		s.serveAnchor(w, anchor, types, list)
		return
	}

	msgs, err := list(store.ListOptions{Before: q.Get("before"), After: q.Get("after"), Limit: limit})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{"messages": msgs}
	// First search page also carries the total match count for the results UI.
	if search != "" && q.Get("before") == "" && q.Get("after") == "" {
		if total, err := s.Store.CountSearch(search, types); err == nil {
			resp["total"] = total
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) serveAnchor(w http.ResponseWriter, anchor string, types []string,
	list func(store.ListOptions) ([]store.Message, error)) {

	const side = 25
	var before, after []store.Message
	var anchorID string
	var err error

	if t, perr := time.ParseInLocation("2006-01-02", anchor, time.Local); perr == nil {
		anchorID = store.IDAt(t)
	} else if len(anchor) == 26 {
		anchorID = anchor
	} else {
		writeErr(w, http.StatusBadRequest, "anchor must be YYYY-MM-DD or a message id")
		return
	}

	before, err = list(store.ListOptions{Before: anchorID, Limit: side})
	if err == nil {
		after, err = list(store.ListOptions{After: anchorID, Limit: side})
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Ascending: reversed before-side, then the anchored message itself (when
	// the anchor is a message id), then the after-side.
	msgs := make([]store.Message, 0, len(before)+len(after)+1)
	for i := len(before) - 1; i >= 0; i-- {
		msgs = append(msgs, before[i])
	}
	if m, err := s.Store.GetMessage(anchorID); err == nil {
		msgs = append(msgs, *m)
	}
	msgs = append(msgs, after...)
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs, "anchor_id": anchorID})
}

func (s *Server) handlePostMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Type != "text" {
		writeErr(w, http.StatusBadRequest, "only type=text is posted here; files go through /api/uploads")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeErr(w, http.StatusBadRequest, "content required")
		return
	}
	m, err := s.Store.CreateTextMessage(req.Content, r.Header.Get("X-Device-Id"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Hub.Broadcast(Event{Event: "new_message", Message: m})
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteMessage(id); err != nil {
		writeErr(w, http.StatusNotFound, "message not found")
		return
	}
	s.Hub.Broadcast(Event{Event: "message_deleted", ID: id})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	st, err := s.Store.Stats(s.MaxStorage)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}
