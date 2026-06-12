package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"lanshare/store"
)

const testToken = "secret-token"

func newTestServer(t *testing.T) (*httptest.Server, *Server) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := NewServer(st, testToken, 1<<40)
	mux := http.NewServeMux()
	srv.Routes(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, srv
}

func req(t *testing.T, ts *httptest.Server, method, path string, body []byte, out any) *http.Response {
	t.Helper()
	r, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+testToken)
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	if out != nil {
		defer resp.Body.Close()
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return resp
}

func TestAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp, _ := http.Get(ts.URL + "/api/messages")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d, want 401", resp.StatusCode)
	}
	r, _ := http.NewRequest("GET", ts.URL+"/api/messages", nil)
	r.Header.Set("Authorization", "Bearer wrong")
	resp, _ = http.DefaultClient.Do(r)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d, want 401", resp.StatusCode)
	}
	// ?token= works for file-style access.
	resp, _ = http.Get(ts.URL + "/api/messages?token=" + testToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("query token: %d, want 200", resp.StatusCode)
	}
}

// TestUploadFlowHTTP drives the whole chunked-upload path over HTTP with
// concurrent PUTs, then verifies resume query, complete, and Range download.
func TestUploadFlowHTTP(t *testing.T) {
	ts, _ := newTestServer(t)

	const size = 2*store.ChunkSize + 999
	data := make([]byte, size)
	for i := range data {
		data[i] = byte(i * 31)
	}

	var init struct {
		UploadID  string `json:"upload_id"`
		ChunkSize int64  `json:"chunk_size"`
		Received  []int  `json:"received"`
	}
	resp := req(t, ts, "POST", "/api/uploads",
		[]byte(fmt.Sprintf(`{"name":"测试 文件.bin","size":%d,"mime":"application/octet-stream"}`, size)), &init)
	if resp.StatusCode != 201 || init.ChunkSize != store.ChunkSize || len(init.Received) != 0 {
		t.Fatalf("init: %d %+v", resp.StatusCode, init)
	}

	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			end := (n + 1) * store.ChunkSize
			if end > size {
				end = size
			}
			r, _ := http.NewRequest("PUT",
				fmt.Sprintf("%s/api/uploads/%s/chunks/%d", ts.URL, init.UploadID, n),
				bytes.NewReader(data[n*store.ChunkSize:end]))
			r.Header.Set("Authorization", "Bearer "+testToken)
			resp, err := http.DefaultClient.Do(r)
			if err != nil || resp.StatusCode != 204 {
				t.Errorf("chunk %d: %v %d", n, err, resp.StatusCode)
			}
		}(i)
	}
	wg.Wait()
	if t.Failed() {
		t.FailNow()
	}

	var status struct {
		Received  []int `json:"received"`
		Completed bool  `json:"completed"`
	}
	req(t, ts, "GET", "/api/uploads/"+init.UploadID, nil, &status)
	if len(status.Received) != 3 || status.Completed {
		t.Fatalf("resume query: %+v", status)
	}

	var msg store.Message
	resp = req(t, ts, "POST", "/api/uploads/"+init.UploadID+"/complete", nil, &msg)
	if resp.StatusCode != 201 || msg.Type != "file" || msg.FileSize != size || msg.FileName != "测试 文件.bin" {
		t.Fatalf("complete: %d %+v", resp.StatusCode, msg)
	}

	// Full download via ?token=.
	dresp, _ := http.Get(fmt.Sprintf("%s/api/files/%s?token=%s", ts.URL, msg.FileID, testToken))
	body, _ := io.ReadAll(dresp.Body)
	if dresp.StatusCode != 200 || !bytes.Equal(body, data) {
		t.Fatalf("download: %d, %d bytes", dresp.StatusCode, len(body))
	}
	if cd := dresp.Header.Get("Content-Disposition"); cd == "" || !bytes.Contains([]byte(cd), []byte("filename*=UTF-8''")) {
		t.Fatalf("Content-Disposition missing RFC 5987: %q", cd)
	}

	// Range request (what aria2 / video seeking relies on).
	r, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/files/%s?token=%s", ts.URL, msg.FileID, testToken), nil)
	r.Header.Set("Range", "bytes=100-199")
	rresp, _ := http.DefaultClient.Do(r)
	part, _ := io.ReadAll(rresp.Body)
	if rresp.StatusCode != http.StatusPartialContent || !bytes.Equal(part, data[100:200]) {
		t.Fatalf("range: %d, %d bytes", rresp.StatusCode, len(part))
	}

	// complete is idempotent: returns the same message.
	var again store.Message
	req(t, ts, "POST", "/api/uploads/"+init.UploadID+"/complete", nil, &again)
	if again.ID != msg.ID {
		t.Fatalf("re-complete returned different message: %s vs %s", again.ID, msg.ID)
	}
}

func TestMessagesAndDevices(t *testing.T) {
	ts, _ := newTestServer(t)

	var dev struct {
		DeviceID string `json:"device_id"`
	}
	req(t, ts, "POST", "/api/devices", []byte(`{"name":"phone"}`), &dev)
	if dev.DeviceID == "" {
		t.Fatal("no device id")
	}

	var msg store.Message
	resp := req(t, ts, "POST", "/api/messages", []byte(`{"type":"text","content":"hello **md**"}`), &msg)
	if resp.StatusCode != 201 || msg.ID == "" {
		t.Fatalf("post message: %d", resp.StatusCode)
	}

	var list struct {
		Messages []store.Message `json:"messages"`
	}
	req(t, ts, "GET", "/api/messages?limit=10", nil, &list)
	if len(list.Messages) != 1 || list.Messages[0].Content != "hello **md**" {
		t.Fatalf("list: %+v", list)
	}

	// Anchor by message id returns the message itself with anchor_id.
	var anchored struct {
		Messages []store.Message `json:"messages"`
		AnchorID string          `json:"anchor_id"`
	}
	req(t, ts, "GET", "/api/messages?anchor="+msg.ID, nil, &anchored)
	if anchored.AnchorID != msg.ID || len(anchored.Messages) != 1 {
		t.Fatalf("anchor: %+v", anchored)
	}

	resp = req(t, ts, "DELETE", "/api/messages/"+msg.ID, nil, nil)
	if resp.StatusCode != 204 {
		t.Fatalf("delete: %d", resp.StatusCode)
	}

	var stats store.Stats
	req(t, ts, "GET", "/api/stats", nil, &stats)
	if stats.MessageCount != 0 {
		t.Fatalf("stats after delete: %+v", stats)
	}
}

// 首次运行模式：无令牌时仅 /api/setup 可用，网页设置后立即生效并持久化。
func TestWebSetup(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := NewServer(st, "", 1<<40) // 空令牌 = 进入设置模式
	mux := http.NewServeMux()
	srv.Routes(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	get := func(path, bearer string) *http.Response {
		r, _ := http.NewRequest("GET", ts.URL+path, nil)
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	post := func(body string) *http.Response {
		resp, err := http.Post(ts.URL+"/api/setup", "application/json", bytes.NewReader([]byte(body)))
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	var status struct{ Needed bool `json:"needed"` }
	resp := get("/api/setup", "")
	json.NewDecoder(resp.Body).Decode(&status)
	if !status.Needed {
		t.Fatal("setup should be needed before a token exists")
	}
	if resp := get("/api/stats", "anything"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("pre-setup auth: %d, want 401", resp.StatusCode)
	}
	if resp := post(`{"token":"short"}`); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("short token: %d, want 400", resp.StatusCode)
	}
	if resp := post(`{"token":"my-new-token"}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("setup: %d, want 204", resp.StatusCode)
	}
	if resp := post(`{"token":"another"}`); resp.StatusCode != http.StatusConflict {
		t.Fatalf("second setup: %d, want 409", resp.StatusCode)
	}
	resp = get("/api/setup", "")
	json.NewDecoder(resp.Body).Decode(&status)
	if status.Needed {
		t.Fatal("setup should not be needed after configuration")
	}
	if resp := get("/api/stats", "my-new-token"); resp.StatusCode != http.StatusOK {
		t.Fatalf("auth with web-set token: %d, want 200", resp.StatusCode)
	}
	// 持久化：新 Server 实例（模拟重启）按 main.go 的方式从 settings 读回。
	saved, err := st.GetSetting("token")
	if err != nil || saved != "my-new-token" {
		t.Fatalf("persisted token = %q, %v", saved, err)
	}
}

// 环境变量固定令牌时，setup 不可用也不需要。
func TestSetupDisabledWithEnvToken(t *testing.T) {
	ts, _ := newTestServer(t)
	var status struct{ Needed bool `json:"needed"` }
	resp, _ := http.Get(ts.URL + "/api/setup")
	json.NewDecoder(resp.Body).Decode(&status)
	if status.Needed {
		t.Fatal("setup must not be needed when a token is configured")
	}
	resp, _ = http.Post(ts.URL+"/api/setup", "application/json",
		bytes.NewReader([]byte(`{"token":"override-attempt"}`)))
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("setup with env token: %d, want 409", resp.StatusCode)
	}
}
