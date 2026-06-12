package store

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"
)

type Message struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Content    string `json:"content,omitempty"`
	FileID     string `json:"file_id,omitempty"`
	DeviceID   string `json:"device_id,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	FileName   string `json:"file_name,omitempty"`
	FileSize   int64  `json:"file_size,omitempty"`
	FileMime   string `json:"file_mime,omitempty"`
	DeviceName string `json:"device_name,omitempty"`
}

type ListOptions struct {
	Before string   // exclusive upper bound: id < Before, newest first
	After  string   // exclusive lower bound: id > After, oldest first
	Limit  int
	Types  []string // expanded type filter, e.g. ["image","video"]
}

const msgSelect = `
SELECT m.id, m.type, m.content, m.file_id, m.device_id, m.created_at,
       COALESCE(u.name,''), COALESCE(u.size,0), COALESCE(u.mime,''), COALESCE(d.name,'')
FROM messages m
LEFT JOIN uploads u ON m.file_id = u.id
LEFT JOIN devices d ON m.device_id = d.id`

func scanMessages(rows *sql.Rows) ([]Message, error) {
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Type, &m.Content, &m.FileID, &m.DeviceID, &m.CreatedAt,
			&m.FileName, &m.FileSize, &m.FileMime, &m.DeviceName); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func buildConds(opts ListOptions) (conds []string, args []any) {
	if opts.Before != "" {
		conds, args = append(conds, "m.id < ?"), append(args, opts.Before)
	}
	if opts.After != "" {
		conds, args = append(conds, "m.id > ?"), append(args, opts.After)
	}
	if len(opts.Types) > 0 {
		ph := strings.Repeat("?,", len(opts.Types))
		conds = append(conds, "m.type IN ("+ph[:len(ph)-1]+")")
		for _, t := range opts.Types {
			args = append(args, t)
		}
	}
	return
}

func (s *Store) listWhere(conds []string, args []any, ascending bool, limit int) ([]Message, error) {
	q := msgSelect
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	if ascending {
		q += " ORDER BY m.id ASC LIMIT ?"
	} else {
		q += " ORDER BY m.id DESC LIMIT ?"
	}
	rows, err := s.readDB.Query(q, append(args, limit)...)
	if err != nil {
		return nil, err
	}
	return scanMessages(rows)
}

// ListMessages pages the timeline by keyset. With After set the result is
// ascending (oldest first); otherwise descending (newest first).
func (s *Store) ListMessages(opts ListOptions) ([]Message, error) {
	conds, args := buildConds(opts)
	return s.listWhere(conds, args, opts.After != "", opts.Limit)
}

// SearchMessages is the only place that knows the search implementation (LIKE
// today); swap to FTS5 here without touching callers.
func (s *Store) SearchMessages(q string, opts ListOptions) ([]Message, error) {
	conds, args := buildConds(opts)
	pat := "%" + escapeLike(q) + "%"
	conds = append(conds, `((m.type = 'text' AND m.content LIKE ? ESCAPE '\') OR (m.type != 'text' AND u.name LIKE ? ESCAPE '\'))`)
	args = append(args, pat, pat)
	return s.listWhere(conds, args, opts.After != "", opts.Limit)
}

// CountSearch returns the total number of messages matching a search, for the
// "第 i / N 条" indicator. Same predicate as SearchMessages.
func (s *Store) CountSearch(q string, types []string) (int, error) {
	conds, args := buildConds(ListOptions{Types: types})
	pat := "%" + escapeLike(q) + "%"
	conds = append(conds, `((m.type = 'text' AND m.content LIKE ? ESCAPE '\') OR (m.type != 'text' AND u.name LIKE ? ESCAPE '\'))`)
	args = append(args, pat, pat)
	query := `SELECT COUNT(*) FROM messages m LEFT JOIN uploads u ON m.file_id = u.id WHERE ` +
		strings.Join(conds, " AND ")
	var n int
	err := s.readDB.QueryRow(query, args...).Scan(&n)
	return n, err
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// AnchorWindow returns up to n messages strictly before the anchor time
// (descending) and n at/after it (ascending). anchorID is the keyset cursor
// derived from the anchor time.
func (s *Store) AnchorWindow(at time.Time, types []string, n int) (before, after []Message, anchorID string, err error) {
	anchorID = IDAt(at)
	bc, ba := buildConds(ListOptions{Before: anchorID, Types: types})
	before, err = s.listWhere(bc, ba, false, n)
	if err != nil {
		return
	}
	ac, aa := buildConds(ListOptions{Types: types})
	ac, aa = append(ac, "m.id >= ?"), append(aa, anchorID)
	after, err = s.listWhere(ac, aa, true, n)
	return
}

func (s *Store) GetMessage(id string) (*Message, error) {
	rows, err := s.readDB.Query(msgSelect+" WHERE m.id = ?", id)
	if err != nil {
		return nil, err
	}
	ms, err := scanMessages(rows)
	if err != nil {
		return nil, err
	}
	if len(ms) == 0 {
		return nil, sql.ErrNoRows
	}
	return &ms[0], nil
}

func (s *Store) CreateTextMessage(content, deviceID string) (*Message, error) {
	m := &Message{ID: s.NewID(), Type: "text", Content: content, DeviceID: deviceID, CreatedAt: nowMs()}
	_, err := s.writeDB.Exec(
		"INSERT INTO messages (id, type, content, file_id, device_id, created_at) VALUES (?,?,?,?,?,?)",
		m.ID, m.Type, m.Content, "", m.DeviceID, m.CreatedAt)
	if err != nil {
		return nil, err
	}
	if d, _ := s.GetDevice(deviceID); d != nil {
		m.DeviceName = d.Name
	}
	return m, nil
}

func (s *Store) createFileMessage(typ, fileID, deviceID string) (*Message, error) {
	m := &Message{ID: s.NewID(), Type: typ, FileID: fileID, DeviceID: deviceID, CreatedAt: nowMs()}
	_, err := s.writeDB.Exec(
		"INSERT INTO messages (id, type, content, file_id, device_id, created_at) VALUES (?,?,?,?,?,?)",
		m.ID, m.Type, "", m.FileID, m.DeviceID, m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return s.GetMessage(m.ID)
}

// DeleteMessage removes the row and, for file messages, the upload record,
// file blob and thumbnail.
func (s *Store) DeleteMessage(id string) error {
	m, err := s.GetMessage(id)
	if err != nil {
		return err
	}
	if _, err := s.writeDB.Exec("DELETE FROM messages WHERE id = ?", id); err != nil {
		return err
	}
	if m.FileID != "" {
		return s.deleteFile(m.FileID)
	}
	return nil
}

func (s *Store) deleteFile(fileID string) error {
	if _, err := s.writeDB.Exec("DELETE FROM uploads WHERE id = ?", fileID); err != nil {
		return err
	}
	if err := os.Remove(s.FilePath(fileID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Remove(s.ThumbPath(fileID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

type Stats struct {
	Used         int64 `json:"used"`
	Limit        int64 `json:"limit"`
	MessageCount int64 `json:"message_count"`
}

func (s *Store) Stats(limit int64) (Stats, error) {
	st := Stats{Limit: limit}
	err := s.readDB.QueryRow(
		"SELECT COALESCE((SELECT SUM(size) FROM uploads WHERE received_bitmap IS NULL),0), (SELECT COUNT(*) FROM messages)").
		Scan(&st.Used, &st.MessageCount)
	return st, err
}

// CleanupStorage deletes oldest file messages (never text) until usage fits
// maxBytes. Returns the ids of deleted messages.
func (s *Store) CleanupStorage(maxBytes int64) ([]string, error) {
	st, err := s.Stats(maxBytes)
	if err != nil {
		return nil, err
	}
	used := st.Used
	var deleted []string
	for used > maxBytes {
		var msgID, fileID string
		var size int64
		err := s.readDB.QueryRow(`
SELECT m.id, m.file_id, u.size FROM messages m
JOIN uploads u ON m.file_id = u.id
WHERE m.type != 'text' ORDER BY m.id ASC LIMIT 1`).Scan(&msgID, &fileID, &size)
		if err == sql.ErrNoRows {
			break
		}
		if err != nil {
			return deleted, err
		}
		if err := s.DeleteMessage(msgID); err != nil {
			return deleted, fmt.Errorf("cleanup %s: %w", msgID, err)
		}
		deleted = append(deleted, msgID)
		used -= size
	}
	return deleted, nil
}
