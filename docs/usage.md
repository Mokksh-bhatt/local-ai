# Usage

See also: [README](../README.md) · [SaaS / app integration](integration-examples.md) · [Quickstart](../README.md#quickstart).

Assume the hub is running: `npm run dev` → `http://127.0.0.1:5173`.

## In the browser

1. Set **Workspace** to a real project folder.
2. Choose **agent** in the composer (Cursor, Claude, Copilot, Codex, Aider).
3. Optional: pick a **model** (Claude / Copilot / Codex).
4. Mode: `agent` (edit), `plan` (plan only), `ask` (read / explain).
5. Permissions: `ask` (approve tools), `auto` (allow edits), `yolo` (least prompting).
6. Send.

If the CLI is missing, **Open site** launches the vendor page. If you are signed out, a sign-in window opens. After either, click **I’ve done this** (or ↻).

The right panel:

- **Changed** — git status/diff for files this turn touched
- **Errors** — CLI and hub errors (not mixed into the chat)
- **Memory** — durable notes in `~/.local-ai/MEMORY.md`
- **Skills** — extra instruction files under `~/.local-ai/skills/`

## HTTP: status

`GET /api/status` returns the same snapshot the UI hydrates from. No auth; localhost only.

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/status | ConvertTo-Json -Depth 6
```

curl (Git Bash / macOS / Linux):

```bash
curl -s http://127.0.0.1:5173/api/status
```

Example shape (fields omitted for brevity):

```json
{
  "type": "status",
  "adapters": [
    {
      "id": "claude",
      "name": "Claude",
      "bin": "C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd",
      "install": "npm i -g @anthropic-ai/claude-code",
      "site": "https://code.claude.com/docs/en/overview",
      "hasLogin": true,
      "loggedIn": true,
      "protocol": "headless",
      "models": ["sonnet", "opus", "haiku", "fable"],
      "model": "sonnet"
    }
  ],
  "workspace": "C:\\src\\my-app",
  "memory": "",
  "skills": [],
  "chat": [],
  "home": "C:\\Users\\you\\.cursor\\Local AI API",
  "recent": ["C:\\src\\my-app"]
}
```

`bin` is `null` when that CLI is not on `PATH`. `loggedIn` is `false` when the hub can tell you are signed out.

## WebSocket: `/hub`

Connect to `ws://127.0.0.1:5173/hub`. Send JSON text frames. First message is usually `hello`.

### Client → hub

```json
{ "type": "hello" }
```

```json
{ "type": "detect" }
```

```json
{ "type": "setWorkspace", "path": "C:\\src\\my-app" }
```

```json
{ "type": "openSite", "adapterId": "codex" }
```

```json
{ "type": "login", "adapterId": "claude" }
```

```json
{
  "type": "prompt",
  "adapterId": "claude",
  "text": "List the scripts in package.json",
  "mode": "ask",
  "permission": "ask",
  "model": "sonnet"
}
```

```json
{ "type": "setModel", "adapterId": "claude", "model": "opus" }
```

```json
{ "type": "cancel" }
```

```json
{ "type": "permission", "requestId": "…", "optionId": "allow-once" }
```

`adapterId` is one of: `cursor` | `claude` | `copilot` | `codex` | `aider`.  
`mode`: `agent` | `plan` | `ask`.  
`permission`: `ask` | `auto` | `yolo`.

### Hub → client

Status (also sent on connect):

```json
{ "type": "status", "adapters": [], "workspace": "", "memory": "", "skills": [], "chat": [], "home": "", "recent": [] }
```

Stream:

```json
{ "type": "event", "event": { "type": "text_delta", "text": "Hello" } }
```

```json
{ "type": "event", "event": { "type": "thought", "text": "…" } }
```

```json
{ "type": "event", "event": { "type": "done" } }
```

```json
{ "type": "event", "event": { "type": "error", "message": "claude is not installed" } }
```

```json
{
  "type": "event",
  "event": {
    "type": "permission",
    "requestId": "1",
    "title": "Run Bash",
    "kind": "tool",
    "options": [{ "optionId": "allow-once", "name": "Allow once" }]
  }
}
```

Diff after a turn:

```json
{ "type": "diff", "status": " M src/app.ts", "patch": "diff --git …" }
```

Browser example:

```javascript
const ws = new WebSocket("ws://127.0.0.1:5173/hub");
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "hello" }));
  ws.send(JSON.stringify({ type: "setWorkspace", path: "C:\\src\\my-app" }));
};
ws.onmessage = (ev) => console.log(JSON.parse(ev.data));
```

## HTTP: one prompt

`POST /api/prompt` runs one turn and returns `{ "text": "…" }` (or `{ "error": "…" }`). There is no approval UI on this path, so `permission: "ask"` is treated as `auto`.

```bash
curl -sS http://127.0.0.1:5173/api/prompt \
  -H "Content-Type: application/json" \
  -d "{\"adapterId\":\"claude\",\"text\":\"Reply with pong only\",\"mode\":\"ask\",\"permission\":\"auto\",\"workspace\":\"C:\\\\src\\\\my-app\"}"
```

Runnable copies: [examples/cli](../examples/cli), [examples/node-basic](../examples/node-basic). Streaming still uses WebSocket `/hub`.

Next: [Integration examples](integration-examples.md) · [FAQ](faq.md)
