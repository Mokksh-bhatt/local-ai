// Express/Flask-shaped sidecar: POST /ask → Local AI hub → JSON { text }.
// Stdlib only. Point HUB at the hub if you changed PORT.
import http from "node:http";

const hub = process.env.HUB || "http://127.0.0.1:5173";
const port = Number(process.env.SIDECAR_PORT) || 8787;
const workspace = process.env.WORKSPACE || process.cwd();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/ask") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "POST /ask with { text, adapterId? }" }));
    return;
  }
  let incoming;
  try {
    incoming = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }
  try {
    const status = await fetch(`${hub}/api/status`).then((r) => r.json());
    const adapterId =
      incoming.adapterId || process.env.ADAPTER || status.adapters.find((a) => a.bin)?.id || "claude";
    const r = await fetch(`${hub}/api/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adapterId,
        text: incoming.text,
        mode: incoming.mode || "ask",
        permission: "auto",
        workspace: incoming.workspace || workspace,
      }),
    });
    const body = await r.json();
    res.statusCode = r.ok ? 200 : 502;
    res.end(JSON.stringify(body));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: `Hub down at ${hub}. Run npm run dev. ${e.message}` }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`sidecar  http://127.0.0.1:${port}/ask   →  ${hub}/api/prompt`);
});
