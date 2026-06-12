package store

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"math/rand"
	"os"
	"sync"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestKeysetPagination(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")
	var ids []string
	for i := 0; i < 25; i++ {
		m, err := s.CreateTextMessage(fmt.Sprintf("msg %d", i), d.ID)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}

	// Page backwards 10 at a time: 10 + 10 + 5, no overlap, no gap.
	var got []string
	cursor := ""
	for {
		page, err := s.ListMessages(ListOptions{Before: cursor, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(page) == 0 {
			break
		}
		for _, m := range page {
			got = append(got, m.ID)
		}
		if len(page) < 10 {
			break
		}
		cursor = page[len(page)-1].ID
	}
	if len(got) != 25 {
		t.Fatalf("got %d messages, want 25", len(got))
	}
	for i, id := range got {
		if id != ids[24-i] {
			t.Fatalf("position %d: got %s want %s", i, id, ids[24-i])
		}
	}

	// Forward from the oldest id: ascending, excludes the cursor itself.
	fw, err := s.ListMessages(ListOptions{After: ids[0], Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(fw) != 24 || fw[0].ID != ids[1] || fw[23].ID != ids[24] {
		t.Fatalf("forward page wrong: len=%d", len(fw))
	}

	// Boundaries: before oldest id -> empty; after newest id -> empty.
	if p, _ := s.ListMessages(ListOptions{Before: ids[0], Limit: 10}); len(p) != 0 {
		t.Fatalf("before-oldest: got %d, want 0", len(p))
	}
	if p, _ := s.ListMessages(ListOptions{After: ids[24], Limit: 10}); len(p) != 0 {
		t.Fatalf("after-newest: got %d, want 0", len(p))
	}
}

func TestSearchAndTypeFilter(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")
	s.CreateTextMessage("hello world", d.ID)
	s.CreateTextMessage("foo bar", d.ID)
	s.CreateTextMessage("100% match_test", d.ID)

	r, err := s.SearchMessages("hello", ListOptions{Limit: 10})
	if err != nil || len(r) != 1 || r[0].Content != "hello world" {
		t.Fatalf("search hello: %v %d", err, len(r))
	}
	// LIKE metacharacters must be literal.
	r, _ = s.SearchMessages("100%", ListOptions{Limit: 10})
	if len(r) != 1 {
		t.Fatalf("search 100%%: got %d, want 1", len(r))
	}
	r, _ = s.SearchMessages("h_llo", ListOptions{Limit: 10})
	if len(r) != 0 {
		t.Fatalf("underscore must not be a wildcard, got %d", len(r))
	}

	// File name search.
	u, _ := s.InitUpload("report-final.pdf", 4, "application/pdf")
	s.SaveChunk(u, 0, bytes.NewReader([]byte("abcd")))
	if _, err := s.CompleteUpload(u.ID, "file", d.ID); err != nil {
		t.Fatal(err)
	}
	r, _ = s.SearchMessages("report", ListOptions{Limit: 10})
	if len(r) != 1 || r[0].FileName != "report-final.pdf" {
		t.Fatalf("file search: got %d", len(r))
	}

	// Type filter.
	r, _ = s.ListMessages(ListOptions{Types: []string{"file"}, Limit: 10})
	if len(r) != 1 {
		t.Fatalf("type=file: got %d, want 1", len(r))
	}
	r, _ = s.ListMessages(ListOptions{Types: []string{"text"}, Limit: 10})
	if len(r) != 3 {
		t.Fatalf("type=text: got %d, want 3", len(r))
	}

	// Count matches the same predicate as SearchMessages.
	if n, err := s.CountSearch("o", nil); err != nil || n != 3 {
		t.Fatalf("count o: %v %d, want 3", err, n) // hello world, foo bar, report-final.pdf
	}
	if n, _ := s.CountSearch("report", []string{"file"}); n != 1 {
		t.Fatalf("count report file: got %d, want 1", n)
	}
	if n, _ := s.CountSearch("report", []string{"text"}); n != 0 {
		t.Fatalf("count report text: got %d, want 0", n)
	}
}

func TestAnchorWindow(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")
	before, _ := s.CreateTextMessage("old", d.ID)
	time.Sleep(5 * time.Millisecond)
	mid := time.Now()
	time.Sleep(5 * time.Millisecond)
	after, _ := s.CreateTextMessage("new", d.ID)

	b, a, _, err := s.AnchorWindow(mid, nil, 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 1 || b[0].ID != before.ID {
		t.Fatalf("before side wrong: %d", len(b))
	}
	if len(a) != 1 || a[0].ID != after.ID {
		t.Fatalf("after side wrong: %d", len(a))
	}
}

// TestConcurrentChunks uploads all chunks from goroutines and verifies the
// merged file byte-for-byte, plus resume bookkeeping along the way.
func TestConcurrentChunks(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")

	const size = 3*ChunkSize + 12345 // 4 chunks, ragged tail
	data := make([]byte, size)
	rand.New(rand.NewSource(1)).Read(data)

	u, err := s.InitUpload("big.bin", size, "application/octet-stream")
	if err != nil {
		t.Fatal(err)
	}
	if u.NumChunks() != 4 {
		t.Fatalf("chunks = %d, want 4", u.NumChunks())
	}

	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			end := int64(n+1) * ChunkSize
			if end > size {
				end = size
			}
			errs <- s.SaveChunk(u, n, bytes.NewReader(data[int64(n)*ChunkSize:end]))
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	u2, _ := s.GetUpload(u.ID)
	if got := u2.Received(); len(got) != 4 {
		t.Fatalf("received = %v, want all 4 (lost bitmap update under concurrency)", got)
	}

	m, err := s.CompleteUpload(u.ID, "file", d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.FileSize != size || m.FileName != "big.bin" {
		t.Fatalf("message meta wrong: %+v", m)
	}
	merged, err := os.ReadFile(s.FilePath(u.ID))
	if err != nil {
		t.Fatal(err)
	}
	if sha256.Sum256(merged) != sha256.Sum256(data) {
		t.Fatal("merged file corrupted")
	}
	if _, err := os.Stat(s.TmpDir(u.ID)); !os.IsNotExist(err) {
		t.Fatal("tmp dir not cleaned after complete")
	}
}

func TestResumeQueryAndIncompleteComplete(t *testing.T) {
	s := newTestStore(t)
	const size = 2*ChunkSize + 7
	u, _ := s.InitUpload("resume.bin", size, "application/octet-stream")

	chunk := make([]byte, ChunkSize)
	if err := s.SaveChunk(u, 1, bytes.NewReader(chunk)); err != nil {
		t.Fatal(err)
	}
	u2, _ := s.GetUpload(u.ID)
	if got := u2.Received(); len(got) != 1 || got[0] != 1 {
		t.Fatalf("received = %v, want [1]", got)
	}
	if _, err := s.CompleteUpload(u.ID, "file", "dev"); err == nil {
		t.Fatal("complete must fail with missing chunks")
	}
	// Wrong-size chunk is rejected and not marked.
	if err := s.SaveChunk(u, 2, bytes.NewReader(make([]byte, 8))); err == nil {
		t.Fatal("short tail chunk accepted (want 7 bytes)")
	}
}

func TestCleanupStorage(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")
	s.CreateTextMessage("keep me forever", d.ID)

	var fileMsgs []string
	for i := 0; i < 3; i++ {
		u, _ := s.InitUpload(fmt.Sprintf("f%d", i), 100, "application/octet-stream")
		if err := s.SaveChunk(u, 0, bytes.NewReader(make([]byte, 100))); err != nil {
			t.Fatal(err)
		}
		m, err := s.CompleteUpload(u.ID, "file", d.ID)
		if err != nil {
			t.Fatal(err)
		}
		fileMsgs = append(fileMsgs, m.ID)
	}
	st, _ := s.Stats(0)
	if st.Used != 300 {
		t.Fatalf("used = %d, want 300", st.Used)
	}

	// Limit 150: must delete the two oldest file messages, keep text.
	deleted, err := s.CleanupStorage(150)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 2 || deleted[0] != fileMsgs[0] || deleted[1] != fileMsgs[1] {
		t.Fatalf("deleted = %v, want oldest two %v", deleted, fileMsgs[:2])
	}
	st, _ = s.Stats(0)
	if st.Used != 100 || st.MessageCount != 2 {
		t.Fatalf("after cleanup: used=%d count=%d", st.Used, st.MessageCount)
	}
	// Text-only over limit: nothing to delete, no infinite loop.
	if _, err := s.CleanupStorage(0); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Stats(0)
	if st.MessageCount != 1 {
		t.Fatal("text message must never be auto-deleted")
	}
}

func TestCleanupStaleUploads(t *testing.T) {
	s := newTestStore(t)
	u, _ := s.InitUpload("stale.bin", ChunkSize, "application/octet-stream")
	s.SaveChunk(u, 0, bytes.NewReader(make([]byte, ChunkSize)))
	// Backdate it.
	if _, err := s.writeDB.Exec("UPDATE uploads SET created_at = ? WHERE id = ?",
		time.Now().Add(-72*time.Hour).UnixMilli(), u.ID); err != nil {
		t.Fatal(err)
	}
	// A fresh incomplete upload must survive.
	fresh, _ := s.InitUpload("fresh.bin", 10, "application/octet-stream")

	n, err := s.CleanupStaleUploads(48 * time.Hour)
	if err != nil || n != 1 {
		t.Fatalf("cleaned %d (%v), want 1", n, err)
	}
	if _, err := s.GetUpload(u.ID); err == nil {
		t.Fatal("stale upload row still present")
	}
	if _, err := os.Stat(s.TmpDir(u.ID)); !os.IsNotExist(err) {
		t.Fatal("stale tmp chunks still on disk")
	}
	if _, err := s.GetUpload(fresh.ID); err != nil {
		t.Fatal("fresh upload was wrongly cleaned")
	}
}

func TestDeleteMessageRemovesFile(t *testing.T) {
	s := newTestStore(t)
	d, _ := s.CreateDevice("test")
	u, _ := s.InitUpload("x.bin", 5, "application/octet-stream")
	s.SaveChunk(u, 0, bytes.NewReader([]byte("12345")))
	m, err := s.CompleteUpload(u.ID, "file", d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteMessage(m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.FilePath(u.ID)); !os.IsNotExist(err) {
		t.Fatal("file blob not removed with message")
	}
	if _, err := s.GetUpload(u.ID); err == nil {
		t.Fatal("upload row not removed with message")
	}
}
