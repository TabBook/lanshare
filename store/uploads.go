package store

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Upload struct {
	ID        string
	Name      string
	Size      int64
	Mime      string
	ChunkSize int64
	Bitmap    []byte // nil once completed
	CreatedAt int64
}

var ErrIncomplete = errors.New("upload incomplete")

func (u *Upload) NumChunks() int {
	if u.Size == 0 {
		return 0
	}
	return int((u.Size + u.ChunkSize - 1) / u.ChunkSize)
}

func (u *Upload) chunkLen(n int) int64 {
	if n == u.NumChunks()-1 {
		if r := u.Size % u.ChunkSize; r != 0 {
			return r
		}
	}
	return u.ChunkSize
}

// Received lists chunk indexes already on disk, for resume queries.
func (u *Upload) Received() []int {
	out := []int{}
	for i := 0; i < u.NumChunks(); i++ {
		if u.Bitmap[i/8]&(1<<(i%8)) != 0 {
			out = append(out, i)
		}
	}
	return out
}

func (s *Store) InitUpload(name string, size int64, mime string) (*Upload, error) {
	if size < 0 {
		return nil, fmt.Errorf("invalid size %d", size)
	}
	u := &Upload{ID: s.NewID(), Name: name, Size: size, Mime: mime, ChunkSize: ChunkSize, CreatedAt: nowMs()}
	u.Bitmap = make([]byte, (u.NumChunks()+7)/8)
	if _, err := s.writeDB.Exec(
		"INSERT INTO uploads (id, name, size, mime, chunk_size, received_bitmap, created_at) VALUES (?,?,?,?,?,?,?)",
		u.ID, u.Name, u.Size, u.Mime, u.ChunkSize, u.Bitmap, u.CreatedAt); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.TmpDir(u.ID), 0o755); err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUpload(id string) (*Upload, error) {
	if err := validID(id); err != nil {
		return nil, sql.ErrNoRows
	}
	var u Upload
	err := s.readDB.QueryRow(
		"SELECT id, name, size, mime, chunk_size, received_bitmap, created_at FROM uploads WHERE id = ?", id).
		Scan(&u.ID, &u.Name, &u.Size, &u.Mime, &u.ChunkSize, &u.Bitmap, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// SaveChunk streams chunk n to tmp/<id>/<n> without buffering it in memory,
// then marks the bit. Concurrent calls for different chunks are safe: the
// bitmap update runs read-modify-write inside a transaction on the single
// write connection.
func (s *Store) SaveChunk(u *Upload, n int, r io.Reader) error {
	if u.Bitmap == nil {
		return fmt.Errorf("upload already completed")
	}
	if n < 0 || n >= u.NumChunks() {
		return fmt.Errorf("chunk %d out of range", n)
	}
	dir := s.TmpDir(u.ID)
	part := filepath.Join(dir, strconv.Itoa(n)+".part")
	f, err := os.Create(part)
	if err != nil {
		return err
	}
	written, err := io.Copy(f, r)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(part)
		return err
	}
	if written != u.chunkLen(n) {
		os.Remove(part)
		return fmt.Errorf("chunk %d: got %d bytes, want %d", n, written, u.chunkLen(n))
	}
	if err := os.Rename(part, filepath.Join(dir, strconv.Itoa(n))); err != nil {
		return err
	}
	return s.markChunk(u.ID, n)
}

func (s *Store) markChunk(id string, n int) error {
	tx, err := s.writeDB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var bm []byte
	if err := tx.QueryRow("SELECT received_bitmap FROM uploads WHERE id = ?", id).Scan(&bm); err != nil {
		return err
	}
	if bm == nil {
		return fmt.Errorf("upload already completed")
	}
	bm[n/8] |= 1 << (n % 8)
	if _, err := tx.Exec("UPDATE uploads SET received_bitmap = ? WHERE id = ?", bm, id); err != nil {
		return err
	}
	return tx.Commit()
}

// CompleteUpload verifies all chunks, preallocates the target and writes each
// chunk at its offset, verifies total size, moves it under files/ and creates
// the message. msgType is text|file|image|video derived by the caller.
func (s *Store) CompleteUpload(id, msgType, deviceID string) (*Message, error) {
	u, err := s.GetUpload(id)
	if err != nil {
		return nil, err
	}
	if u.Bitmap == nil { // already completed: idempotent lookup
		var msgID string
		if err := s.readDB.QueryRow("SELECT id FROM messages WHERE file_id = ?", id).Scan(&msgID); err == nil {
			return s.GetMessage(msgID)
		}
		return nil, fmt.Errorf("upload %s already completed", id)
	}
	n := u.NumChunks()
	if got := len(u.Received()); got != n {
		return nil, fmt.Errorf("%w: %d/%d chunks", ErrIncomplete, got, n)
	}

	dir := s.TmpDir(u.ID)
	merged := filepath.Join(dir, "merged")
	out, err := os.Create(merged)
	if err != nil {
		return nil, err
	}
	if err := out.Truncate(u.Size); err != nil { // preallocate
		out.Close()
		return nil, err
	}
	for i := 0; i < n; i++ {
		c, err := os.Open(filepath.Join(dir, strconv.Itoa(i)))
		if err != nil {
			out.Close()
			return nil, err
		}
		if _, err := out.Seek(int64(i)*u.ChunkSize, io.SeekStart); err == nil {
			_, err = io.Copy(out, c)
		}
		c.Close()
		if err != nil {
			out.Close()
			return nil, err
		}
	}
	fi, err := out.Stat()
	if err == nil && fi.Size() != u.Size {
		err = fmt.Errorf("merged size %d != declared %d", fi.Size(), u.Size)
	}
	if serr := out.Sync(); err == nil {
		err = serr
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return nil, err
	}

	final := s.FilePath(u.ID)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(merged, final); err != nil {
		return nil, err
	}
	os.RemoveAll(dir)

	if _, err := s.writeDB.Exec("UPDATE uploads SET received_bitmap = NULL WHERE id = ?", u.ID); err != nil {
		return nil, err
	}
	return s.createFileMessage(msgType, u.ID, deviceID)
}

// CleanupStaleUploads drops incomplete uploads older than maxAge along with
// their tmp chunks.
func (s *Store) CleanupStaleUploads(maxAge time.Duration) (int, error) {
	cutoff := time.Now().Add(-maxAge).UnixMilli()
	rows, err := s.readDB.Query(
		"SELECT id FROM uploads WHERE received_bitmap IS NOT NULL AND created_at < ?", cutoff)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if _, err := s.writeDB.Exec("DELETE FROM uploads WHERE id = ?", id); err != nil {
			return 0, err
		}
		os.RemoveAll(s.TmpDir(id))
	}
	return len(ids), nil
}
