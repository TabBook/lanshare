package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // scratch 镜像无 /usr/share/zoneinfo，内嵌使 TZ 环境变量生效

	"lanshare/api"
	"lanshare/store"
)

func main() {
	token := os.Getenv("TOKEN")
	if token == "" {
		log.Fatal("TOKEN environment variable is required")
	}
	dataDir := envOr("DATA_DIR", "/data")
	port := envOr("PORT", "10088")
	maxStorage, err := parseSize(envOr("MAX_STORAGE", "50GB"))
	if err != nil {
		log.Fatalf("MAX_STORAGE: %v", err)
	}

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	srv := api.NewServer(st, token, maxStorage)
	mux := http.NewServeMux()
	srv.Routes(mux)
	mux.Handle("/", staticHandler())

	httpSrv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No global write timeout: large file transfers legitimately run long.
	}

	go maintenance(st, maxStorage)

	go func() {
		log.Printf("lanshare listening on :%s (data: %s, max storage: %d bytes)", port, dataDir, maxStorage)
		if err := httpSrv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	log.Print("shutting down, draining in-flight requests")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	httpSrv.Shutdown(ctx)
}

// maintenance runs hourly: enforce the storage cap (oldest file messages
// first, text never) and drop incomplete uploads older than 48h.
func maintenance(st *store.Store, maxStorage int64) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if deleted, err := st.CleanupStorage(maxStorage); err != nil {
			log.Printf("storage cleanup: %v", err)
		} else if len(deleted) > 0 {
			log.Printf("storage cleanup: removed %d old file messages", len(deleted))
		}
		if n, err := st.CleanupStaleUploads(48 * time.Hour); err != nil {
			log.Printf("stale upload cleanup: %v", err)
		} else if n > 0 {
			log.Printf("stale upload cleanup: removed %d incomplete uploads", n)
		}
		<-tick.C
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// parseSize accepts "50GB", "500MB", "10G", "1TB" or plain bytes.
func parseSize(s string) (int64, error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	mult := int64(1)
	for _, u := range []struct {
		suffix string
		mult   int64
	}{{"TB", 1 << 40}, {"GB", 1 << 30}, {"MB", 1 << 20}, {"KB", 1 << 10}, {"T", 1 << 40}, {"G", 1 << 30}, {"M", 1 << 20}, {"K", 1 << 10}, {"B", 1}} {
		if strings.HasSuffix(s, u.suffix) {
			s, mult = strings.TrimSuffix(s, u.suffix), u.mult
			break
		}
	}
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid size %q", s)
	}
	return n * mult, nil
}
