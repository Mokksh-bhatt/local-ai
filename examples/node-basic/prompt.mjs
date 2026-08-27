// Minimal client: POST /api/prompt and print the reply.
// Requires: hub on 127.0.0.1:5173, a workspace folder, an installed CLI.
const hub = process.env.HUB || "http://127.0.0.1:5173";
const workspace = process.env.WORKSPACE || process.cwd();
const text = process.env.TEXT || "Reply with pong only. No extra words.";

const status = await fetch(`${hub}/api/status`).then((r) => {
  if (!r.ok) throw new Error(`Hub not reachable at ${hub}. Start it with: npm run dev`);
  return r.json();
});

const adapterId =
  process.env.ADAPTER || status.adapters.find((a) => a.bin)?.id || "claude";

const res = await fetch(`${hub}/api/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    adapterId,
    text,
    mode: "ask",
    permission: "auto", // HTTP has no approval UI; ask is treated as auto
    workspace,
  }),
});

const body = await res.json();
if (body.error) {
  console.error(body.error);
  process.exit(1);
}
console.log(body.text);
