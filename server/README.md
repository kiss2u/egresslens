# egress-echo

The server side of EgressLens on the 1ms.dog VPS (Tokyo): one destination the page asks over several protocols and
ports, so a different exit can only come from the visitor's proxy rules. Ports, user and directory are assigned in
1ms-shell `docs/processes.md` ("专用服务器").

| | |
|---|---|
| STUN (RFC 5389 Binding) | `stun.1ms.dog`, UDP 3478, 19302, 51820, 40000, IPv4 and IPv6 |
| HTTPS echo | `echo.1ms.dog`, TCP 4433, 8080, 8443, 9443, 10443: `GET /` → `{"ip","port","proto"}`, any origin |
| WebSocket | `wss://echo.1ms.dog:8443/ws`: greets `{"v":1,"pop":"NRT"}`, then echoes text frames (64 bytes at most, 60 messages or 30 s), origins `https://1ms.dog`, `https://*.1ms.dog` and localhost; the 1ms.dog home page times round trips with it |

Nothing is logged or stored; errors only. Without a certificate the HTTPS ports stay off and STUN still runs.

Build (on any machine with Go) and deploy:

```bash
cd server && go test ./... && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o egress-echo .
```

Upload `egress-echo` to `/opt/1ms/egress/` and `1ms-egress.service` to `/etc/systemd/system/`, then
`systemctl daemon-reload && systemctl enable --now 1ms-egress`. The certificate for `echo.1ms.dog` is issued by
Public's certbot and read through `LoadCredential=`; Public restarts the service after a renewal.
