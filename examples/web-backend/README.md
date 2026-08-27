# Tiny HTTP backend

A localhost server (same pattern as `app.post("/ask", …)` in Express or a Flask view) that forwards to the Local AI hub. Your SaaS would run this **on the user's machine**, not in your cloud.

## Run

```bash
npm install
npm run dev
```

In another terminal, from the **repo root**:

```bash
node examples/web-backend/server.mjs
```

Then:

```bash
curl -sS http://127.0.0.1:8787/ask -H "Content-Type: application/json" -d "{\"text\":\"Reply with pong only\"}"
```

On Windows PowerShell, use `curl.exe` so you get real curl, not `Invoke-WebRequest`.
