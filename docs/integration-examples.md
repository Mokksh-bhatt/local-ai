# Integration examples

See also: [README — Usage Examples](../README.md#usage-examples) and [Usage](usage.md).

The hub listens on **localhost**. Remote users cannot reach your keys unless they already have access to that machine. Your app’s job is to *instruct* people to run Local AI plus a vendor CLI, then talk to `127.0.0.1`.

## Web app (same machine as the user)

A desktop-style SaaS, Electron app, or “localhost helper” page can treat the hub like a sidecar.

```html
<button id="go">Ask local Claude</button>
<pre id="out"></pre>
<script>
  document.getElementById("go").onclick = () => {
    const out = document.getElementById("out");
    const ws = new WebSocket("ws://127.0.0.1:5173/hub");
    ws.onerror = () => {
      out.textContent =
        "Local AI is not running. Start it with npm run dev, install a CLI from its site, then retry.";
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "event" && msg.event.type === "text_delta") {
        out.textContent += msg.event.text;
      }
      if (msg.type === "event" && msg.event.type === "error") {
        out.textContent += "\n" + msg.event.message;
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello" }));
      ws.send(
        JSON.stringify({
          type: "prompt",
          adapterId: "claude",
          text: "Reply with pong only",
          mode: "ask",
          permission: "ask",
        }),
      );
    };
  };
</script>
```

If `WebSocket` fails, show: start the hub, then install/sign in from the Local AI UI. Do not fall back to *your* cloud API key unless that is an explicit paid path.

Check readiness before connecting:

```javascript
const status = await fetch("http://127.0.0.1:5173/api/status")
  .then((r) => r.json())
  .catch(() => null);
if (!status) {
  // Hub down → “Install / start Local AI”
} else {
  const claude = status.adapters.find((a) => a.id === "claude");
  if (!claude?.bin) {
    // Point them at claude.site or open the Local AI UI
  } else if (claude.loggedIn === false) {
    // Ask them to sign in (the UI will open the vendor login)
  }
}
```

## Backend (internal tool)

A Node service on the **same host** as the engineer can proxy to the hub. Keep it loopback. Do not expose `/hub` to the public internet.

```javascript
import WebSocket from "ws";

function askLocal(text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:5173/hub");
    let acc = "";
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello" }));
      ws.send(
        JSON.stringify({
          type: "prompt",
          adapterId: "copilot",
          text,
          mode: "ask",
          permission: "ask",
        }),
      );
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type !== "event") return;
      if (msg.event.type === "text_delta") acc += msg.event.text;
      if (msg.event.type === "error") reject(new Error(msg.event.message));
      if (msg.event.type === "done") {
        ws.close();
        resolve(acc);
      }
    });
  });
}
```

Same idea with one HTTP call (no WebSocket):

```javascript
const r = await fetch("http://127.0.0.1:5173/api/prompt", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    adapterId: "copilot",
    text: "Summarize this stack trace",
    mode: "ask",
    permission: "auto",
    workspace: process.cwd(),
  }),
});
const { text, error } = await r.json();
```

Drop-in samples: [examples/web-backend](../examples/web-backend), [examples/node-basic](../examples/node-basic).

Use this for ticket bots, PR comment drafts, or “explain this stack trace” on a developer laptop — billed to Copilot/Claude seats, not to an internal OpenAI invoice.

## CLI wrapper

A Python helper that only runs if the hub is up:

```python
import json, urllib.request
from websocket import create_connection  # pip install websocket-client

def status():
    with urllib.request.urlopen("http://127.0.0.1:5173/api/status") as r:
        return json.load(r)

def prompt(text, adapter="claude"):
    ws = create_connection("ws://127.0.0.1:5173/hub")
    ws.send(json.dumps({"type": "hello"}))
    ws.send(json.dumps({
        "type": "prompt",
        "adapterId": adapter,
        "text": text,
        "mode": "ask",
        "permission": "ask",
    }))
    out = []
    while True:
        msg = json.loads(ws.recv())
        if msg.get("type") != "event":
            continue
        ev = msg["event"]
        if ev["type"] == "text_delta":
            out.append(ev["text"])
        elif ev["type"] == "error":
            raise RuntimeError(ev["message"])
        elif ev["type"] == "done":
            break
    ws.close()
    return "".join(out)

info = status()
print("workspace:", info.get("workspace"))
print(prompt("Summarize package.json scripts"))
```

If status fails, print the same two steps the UI uses: start `npm run dev`, install the CLI from its official site.

## What not to do

- Do not put Anthropic/OpenAI keys in *your* server “on behalf of” Local AI. That undoes BYOK.
- Do not assume Gemini; it is not an adapter.
- Do not rely on Vite HMR; after hub code changes, restart `npm run dev`.

Next: [FAQ](faq.md)
