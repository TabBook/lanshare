// Package store owns SQLite persistence and file storage layout under DATA_DIR.
package store

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	_ "modernc.org/sqlite"
)

const ChunkSize = 8 << 20 // 8MB, fixed by spec

type Store struct {
	writeDB *sql.DB // MaxOpenConns(1): single-writer serialization
	readDB  *sql.DB
	dataDir string

	ulidMu sync.Mutex
	ulidEn *ulid.MonotonicEntropy
}

func Open(dataDir string) (*Store, error) {
	for _, d := range []string{dataDir, filepath.Join(dataDir, "files"), filepath.Join(dataDir, "thumbs"), filepath.Join(dataDir, "tmp")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := "file:" + filepath.Join(dataDir, "share.db") +
		"?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=cache_size(-20000)"

	writeDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	writeDB.SetMaxOpenConns(1)

	readDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		writeDB.Close()
		return nil, err
	}
	readDB.SetMaxOpenConns(8)

	s := &Store{
		writeDB: writeDB,
		readDB:  readDB,
		dataDir: dataDir,
		ulidEn:  ulid.Monotonic(rand.Reader, 0),
	}
	if err := s.migrate(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.writeDB.Exec(`
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  file_id    TEXT NOT NULL DEFAULT '',
  device_id  TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_type_created ON messages(type, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  mime            TEXT NOT NULL,
  chunk_size      INTEGER NOT NULL,
  received_bitmap BLOB,
  created_at      INTEGER NOT NULL
);`)
	return err
}

func (s *Store) Close() error {
	s.readDB.Close()
	return s.writeDB.Close()
}

// NewID returns a lowercase ULID; lexicographic order matches time order.
func (s *Store) NewID() string {
	s.ulidMu.Lock()
	defer s.ulidMu.Unlock()
	return strings.ToLower(ulid.MustNew(ulid.Now(), s.ulidEn).String())
}

// IDAt returns the smallest ULID for a given time, usable as a keyset anchor.
func IDAt(t time.Time) string {
	var u ulid.ULID
	u.SetTime(ulid.Timestamp(t))
	return strings.ToLower(u.String())
}

func nowMs() int64 { return time.Now().UnixMilli() }

// FilePath returns the on-disk path for a stored file: files/<id[:2]>/<id>.
func (s *Store) FilePath(id string) string {
	return filepath.Join(s.dataDir, "files", id[:2], id)
}

func (s *Store) ThumbPath(id string) string {
	return filepath.Join(s.dataDir, "thumbs", id+".jpg")
}

func (s *Store) TmpDir(id string) string {
	return filepath.Join(s.dataDir, "tmp", id)
}

func (s *Store) DataDir() string { return s.dataDir }

func validID(id string) error {
	if len(id) != 26 {
		return fmt.Errorf("invalid id %q", id)
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') {
			return fmt.Errorf("invalid id %q", id)
		}
	}
	return nil
}
