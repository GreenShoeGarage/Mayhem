# Required static-host headers

Serve every MAYHEM RTL asset over Hypertext Transfer Protocol Secure (HTTPS) and add:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: usb=(self), camera=(), microphone=(), geolocation=()
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

Serve `.wasm` files as `application/wasm`. The checked-in Content Security Policy is also present in `index.html`; an equivalent response header is preferred.
