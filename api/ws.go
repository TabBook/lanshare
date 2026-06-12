package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"lanshare/store"
)

type Event struct {
	Event   string         `json:"event"` // new_message | message_deleted
	Message *store.Message `json:"message,omitempty"`
	ID      string         `json:"id,omitempty"`
}

// Hub fans events out from a single goroutine. Each client gets a buffered
// channel; a client that can't keep up gets dropped instead of ever blocking
// the broadcast (the browser reconnects and refetches).
type Hub struct {
	register   chan *client
	unregister chan *client
	broadcast  chan Event
	clients    map[*client]struct{}
}

type client struct {
	conn *websocket.Conn
	send chan Event
}

func NewHub() *Hub {
	return &Hub{
		register:   make(chan *client),
		unregister: make(chan *client),
		broadcast:  make(chan Event, 64),
		clients:    map[*client]struct{}{},
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = struct{}{}
		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
		case ev := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- ev:
				default: // slow client: drop it, never stall the hub
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}

func (h *Hub) Broadcast(ev Event) { h.broadcast <- ev }

var upgrader = websocket.Upgrader{
	// Same-LAN tool with token auth; origin checks add nothing here.
	CheckOrigin: func(*http.Request) bool { return true },
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &client{conn: conn, send: make(chan Event, 32)}
	s.Hub.register <- c

	// Reader: we never expect client messages, but reading drives pong and
	// close handling.
	go func() {
		conn.SetReadLimit(512)
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(90 * time.Second))
			return nil
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				s.Hub.unregister <- c
				conn.Close()
				return
			}
		}
	}()

	// Writer: events + keepalive pings, write deadline kicks slow links.
	go func() {
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		defer conn.Close()
		for {
			select {
			case ev, ok := <-c.send:
				if !ok {
					return
				}
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteJSON(ev); err != nil {
					s.Hub.unregister <- c
					return
				}
			case <-ping.C:
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					s.Hub.unregister <- c
					return
				}
			}
		}
	}()
}
