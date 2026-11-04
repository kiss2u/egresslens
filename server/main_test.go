package main

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func request(id byte) []byte {
	q := make([]byte, 20)
	binary.BigEndian.PutUint16(q[0:2], 0x0001)
	binary.BigEndian.PutUint32(q[4:8], cookie)
	for i := 8; i < 20; i++ {
		q[i] = id + byte(i)
	}
	return q
}

// decode reads XOR-MAPPED-ADDRESS back, the way a browser does
func decode(t *testing.T, q, r []byte) netip.AddrPort {
	t.Helper()
	if binary.BigEndian.Uint16(r[0:2]) != 0x0101 || string(r[4:20]) != string(q[4:20]) {
		t.Fatalf("bad header % x", r[:20])
	}
	a := r[20:]
	port := binary.BigEndian.Uint16(a[6:8]) ^ uint16(cookie>>16)
	if a[5] == 1 {
		var v [4]byte
		binary.BigEndian.PutUint32(v[:], binary.BigEndian.Uint32(a[8:12])^cookie)
		return netip.AddrPortFrom(netip.AddrFrom4(v), port)
	}
	var v [16]byte
	for i := range v {
		v[i] = a[8+i] ^ q[4+i]
	}
	return netip.AddrPortFrom(netip.AddrFrom16(v), port)
}

func TestStunAnswers(t *testing.T) {
	for _, s := range []string{"203.0.113.7:51000", "[::ffff:203.0.113.7]:51000", "[2001:db8::1]:40000"} {
		from := netip.MustParseAddrPort(s)
		q := request(3)
		r := answer(q, from)
		if r == nil {
			t.Fatal(s, "no answer")
		}
		got, want := decode(t, q, r), netip.AddrPortFrom(from.Addr().Unmap(), from.Port())
		if got != want {
			t.Fatalf("%s: got %s", s, got)
		}
		if int(binary.BigEndian.Uint16(r[2:4]))+20 != len(r) {
			t.Fatal("length")
		}
	}
	q := request(1)
	q[1] = 0x11 // a Binding indication, not a request
	if answer(q, netip.MustParseAddrPort("203.0.113.7:1")) != nil || answer([]byte("GET / HTTP/1.1\r\n\r\n12"), netip.MustParseAddrPort("203.0.113.7:1")) != nil {
		t.Fatal("answered something that isn't a Binding request")
	}
}

func TestOrigins(t *testing.T) {
	for o, ok := range map[string]bool{"https://1ms.dog": true, "https://egress.1ms.dog": true, "http://localhost:8787": true,
		"https://evil.com": false, "https://1ms.dog.evil.com": false, "http://egress.1ms.dog": false, "": false, "https://x1ms.dog": false} {
		if allowed(o) != ok {
			t.Errorf("%q: %v", o, !ok)
		}
	}
}

func TestEcho(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(echo))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u := "ws" + strings.TrimPrefix(srv.URL, "http")
	if _, _, err := websocket.Dial(ctx, u, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://evil.com"}}}); err == nil {
		t.Fatal("foreign origin accepted")
	}
	c, _, err := websocket.Dial(ctx, u, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://1ms.dog"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	if _, m, _ := c.Read(ctx); string(m) != `{"v":1,"pop":"NRT"}` {
		t.Fatalf("greeting %q", m)
	}
	for _, p := range []string{"p0", "p1"} {
		c.Write(ctx, websocket.MessageText, []byte(p))
		if _, m, _ := c.Read(ctx); string(m) != p {
			t.Fatalf("echo %q", m)
		}
	}
	c.Write(ctx, websocket.MessageText, []byte(strings.Repeat("x", 65)))
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("a 65-byte frame was echoed")
	}
}
