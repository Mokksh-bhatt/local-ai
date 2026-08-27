import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import type { AdapterId, ChatTurn, ClientMsg, Mode, PermDecision, Permission, ServerMsg, StreamEvent } from "../shared.ts";
import { detect, headlessSpec, invalidateDetect, openUrl, spawnLogin, type Adapter, type Parser } from "./adapters.ts";
import { startAcp, type AcpSession } from "./acp.ts";
import { runHeadless } from "./headless.ts";
import {
  ensureDataDir,
  gitDiff,
  gitTurnDiff,
  isDir,
  listDirs,
  listSkills,
  loadChat,
  saveChat,
  buildPrompt,
  readMemory,
  readState,
  rememberWorkspace,
  saveMemory,
  toggleSkill,
  writeState,
} from "./context.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
ensureDataDir();

type Conn = {
  ws: WebSocket;
  workspace: string;
  adapterId: AdapterId;
  mode: Mode;
  permission: Permission;
  acp: AcpSession | null;
  acpAdapter: AdapterId | null;
  acpModel: string | null;
  resume: Partial<Record<AdapterId, string>>;
  busy: boolean;
  abort: AbortController | null;
  pendingPerm: Map<string, (d: PermDecision) => void>;
  chat: ChatTurn[];
  lastAdapter?: AdapterId;
};

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

async function snapshot(workspace: string): Promise<Extract<ServerMsg, { type: "status" }>> {
  const found = await detect();
  const state = readState();
  const cwd = workspace || state.workspace || "";
  const valid = cwd && isDir(cwd);
  return {
    type: "status",
    adapters: found.map(({ adapter, bin, loggedIn, models }) => ({
      id: adapter.id,
      name: adapter.name,
      bin,
      install: adapter.install,
      site: adapter.site,
      hasLogin: adapter.login.length > 0,
      loggedIn,
      protocol: adapter.protocol,
      models,
      model: (state.models?.[adapter.id] && models.includes(state.models[adapter.id]!))
        ? state.models[adapter.id]!
        : models[0] || null,
    })),
    workspace: valid ? cwd : cwd,
    memory: valid ? readMemory(cwd) : "",
    skills: valid ? listSkills(cwd) : [],
    chat: valid ? loadChat(cwd) : [],
    home: path.join(root),
    recent: state.recent,
    error: cwd && !valid ? `Not a folder: ${cwd}` : undefined,
  };
}

async function pushStatus(conn: Conn) {
  send(conn.ws, await snapshot(conn.workspace));
}

const httpServer = http.createServer();
const vite = await createVite({
  root,
  configFile: path.join(root, "vite.config.ts"),
  appType: "spa",
  server: { middlewareMode: true, hmr: false }, // ponytail: HMR on the same HTTP server ate /hub upgrades
});
httpServer.on("request", async (req, res) => {
  const url = req.url?.split("?")[0] || "";
  if (url === "/api/status") {
    const s = readState();
    const body = await snapshot(s.workspace && isDir(s.workspace) ? s.workspace : "");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
    return;
  }
  if (url === "/api/prompt") {
    await httpPrompt(req, res);
    return;
  }
  vite.middlewares(req, res);
});

const wss = new WebSocketServer({ noServer: true });
httpServer.prependListener("upgrade", (req, socket, head) => {
  if ((req.url || "").startsWith("/hub")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  }
});

wss.on("connection", (ws) => {
  const state = readState();
  const conn: Conn = {
    ws,
    workspace: state.workspace && isDir(state.workspace) ? state.workspace : "",
    adapterId: state.adapterId || "cursor",
    mode: "agent",
    permission: "ask",
    acp: null,
    acpAdapter: null,
    acpModel: null,
    resume: {},
    busy: false,
    abort: null,
    pendingPerm: new Map(),
    chat: state.workspace && isDir(state.workspace) ? loadChat(state.workspace) : [],
  };
  void pushStatus(conn);

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return;
    }
    void handle(conn, msg).catch((e) => {
      send(conn.ws, { type: "event", event: { type: "error", message: String(e?.message || e) } });
      conn.busy = false;
    });
  });
  ws.on("close", () => {
    conn.acp?.dispose();
    conn.abort?.abort();
    rejectPerms(conn);
  });
});

function rejectPerms(conn: Conn) {
  for (const resolve of conn.pendingPerm.values()) resolve({ optionId: "reject-once" });
  conn.pendingPerm.clear();
}

async function handle(conn: Conn, msg: ClientMsg) {
  if (msg.type === "hello" || msg.type === "detect") return pushStatus(conn);
  if (msg.type === "setWorkspace") {
    conn.workspace = path.resolve(msg.path.trim());
    if (conn.workspace && isDir(conn.workspace)) rememberWorkspace(conn.workspace);
    conn.acp?.dispose();
    conn.acp = null;
    conn.acpAdapter = null;
    conn.acpModel = null;
    conn.resume = {};
    conn.lastAdapter = undefined;
    conn.chat = isDir(conn.workspace) ? loadChat(conn.workspace) : [];
    return pushStatus(conn);
  }
  if (msg.type === "ls") return send(conn.ws, { type: "ls", ...listDirs(msg.path) });
  if (msg.type === "saveMemory") {
    if (!isDir(conn.workspace)) throw new Error("Pick a workspace first");
    saveMemory(conn.workspace, msg.text);
    return pushStatus(conn);
  }
  if (msg.type === "toggleSkill") {
    toggleSkill(msg.id, msg.enabled);
    return pushStatus(conn);
  }
  if (msg.type === "setModel") {
    const s = readState();
    s.models = { ...s.models, [msg.adapterId]: msg.model };
    writeState(s);
    return pushStatus(conn);
  }
  if (msg.type === "permission") {
    conn.pendingPerm.get(msg.requestId)?.({ optionId: msg.optionId, answers: msg.answers });
    conn.pendingPerm.delete(msg.requestId);
    return;
  }
  if (msg.type === "cancel") {
    conn.abort?.abort();
    conn.acp?.cancel();
    conn.acp?.dispose();
    conn.acp = null;
    conn.acpAdapter = null;
    conn.acpModel = null;
    rejectPerms(conn);
    conn.busy = false;
    emit(conn, { type: "log", text: "cancelled" });
    emit(conn, { type: "done" });
    return;
  }
  if (msg.type === "login") return login(conn, msg.adapterId);
  if (msg.type === "openSite") {
    const row = (await detect()).find((d) => d.adapter.id === msg.adapterId);
    if (!row) return;
    openUrl(row.adapter.site);
    emit(conn, { type: "log", text: `Opened ${row.adapter.name} install page. After setup, click Refresh.` });
    return;
  }
  if (msg.type === "prompt") return prompt(conn, msg);
}

function emit(conn: Conn, event: StreamEvent) {
  send(conn.ws, { type: "event", event });
}

async function login(conn: Conn, id: AdapterId) {
  const row = (await detect()).find((d) => d.adapter.id === id);
  if (!row?.bin) throw new Error(`${id} is not installed`);
  if (!row.adapter.login.length) {
    emit(conn, { type: "log", text: `Sign in from a terminal: ${row.adapter.bins[0]}` });
    return;
  }
  emit(conn, {
    type: "log",
    text: `Opening ${row.adapter.name} sign-in in a visible window. Finish there, then Refresh CLIs.`,
  });
  const child = spawnLogin(row.bin, row.adapter.login, conn.workspace || process.cwd());
  if (process.platform === "win32") return;
  child.stdout?.on("data", (b: Buffer) => emit(conn, { type: "log", text: b.toString() }));
  child.stderr?.on("data", (b: Buffer) => emit(conn, { type: "log", text: b.toString() }));
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  invalidateDetect();
  await pushStatus(conn);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function oneShotConn(workspace: string): Conn {
  return {
    ws: { readyState: 1, send() {} } as unknown as WebSocket,
    workspace,
    adapterId: "cursor",
    mode: "ask",
    permission: "auto",
    acp: null,
    acpAdapter: null,
    acpModel: null,
    resume: {},
    busy: false,
    abort: null,
    pendingPerm: new Map(),
    chat: isDir(workspace) ? loadChat(workspace) : [],
  };
}

async function httpPrompt(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader("content-type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "POST a JSON body to /api/prompt" }));
    return;
  }
  let body: {
    adapterId?: AdapterId;
    text?: string;
    mode?: Mode;
    permission?: Permission;
    model?: string;
    workspace?: string;
  };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }
  const text = (body.text || "").trim();
  if (!text) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "text is required" }));
    return;
  }
  const state = readState();
  const workspace = path.resolve(body.workspace || state.workspace || "");
  const permission: Permission = body.permission === "ask" ? "auto" : body.permission || "auto";
  const conn = oneShotConn(workspace);
  try {
    const reply = await prompt(conn, {
      type: "prompt",
      adapterId: body.adapterId || state.adapterId || "claude",
      text,
      mode: body.mode || "ask",
      permission,
      model: body.model,
    });
    res.end(JSON.stringify({ text: reply }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String((e as Error).message || e) }));
  } finally {
    conn.acp?.dispose();
    conn.abort?.abort();
  }
}

async function prompt(conn: Conn, msg: Extract<ClientMsg, { type: "prompt" }>) {
  if (conn.busy) throw new Error("Already running");
  if (!isDir(conn.workspace)) throw new Error("Pick a workspace folder first");
  const found = await detect();
  const row = found.find((d) => d.adapter.id === msg.adapterId);
  if (!row?.bin) {
    throw new Error(
      `${msg.adapterId} is not installed. ${row?.adapter.install || "Install the official CLI and put it on PATH."}`,
    );
  }

  conn.busy = true;
  conn.adapterId = msg.adapterId;
  conn.mode = msg.mode;
  conn.permission = msg.permission;
  conn.abort = new AbortController();
  const s = readState();
  s.adapterId = msg.adapterId;
  if (msg.model) {
    s.models = { ...s.models, [msg.adapterId]: msg.model };
  }
  writeState(s);
  send(conn.ws, { type: "diff", status: "", patch: "" });
  const before = await gitDiff(conn.workspace);

  const sameThread = conn.lastAdapter === msg.adapterId && (!!conn.acp || !!conn.resume[msg.adapterId]);
  if (!sameThread) {
    conn.acp?.dispose();
    conn.acp = null;
    conn.acpAdapter = null;
    conn.acpModel = null;
  }
  const text = buildPrompt({
    memory: readMemory(conn.workspace),
    skills: listSkills(conn.workspace),
    history: sameThread ? [] : conn.chat,
    user: msg.text,
  });
  conn.chat.push({ role: "user", text: msg.text });
  saveChat(conn.workspace, conn.chat);
  let assistant = "";
  const onEvent = (e: StreamEvent) => {
    if (e.type === "text_delta") assistant += e.text;
    if (e.type === "done" && e.sessionId) conn.resume[msg.adapterId] = e.sessionId;
    emit(conn, e);
  };

  try {
    const usedAcp = await runAdapter(conn, row.adapter, row.bin, text, onEvent, msg.model, sameThread);
    if (usedAcp) onEvent({ type: "done", sessionId: conn.acp?.sessionId });
    if (assistant.trim()) {
      conn.chat.push({ role: "assistant", text: assistant.trim() });
      saveChat(conn.workspace, conn.chat);
    }
    conn.lastAdapter = msg.adapterId;
    send(conn.ws, { type: "diff", ...(await gitTurnDiff(conn.workspace, before)) });
    return assistant;
  } finally {
    conn.busy = false;
    conn.abort = null;
  }
}

async function runAdapter(
  conn: Conn,
  adapter: Adapter,
  bin: string,
  text: string,
  onEvent: (e: StreamEvent) => void,
  model?: string,
  sameThread?: boolean,
): Promise<boolean> {
  const ask = (req: Extract<StreamEvent, { type: "permission" }>) => decidePermission(conn, req);
  const chosen = model && model !== "auto" ? model : undefined;
  const resumeId = sameThread ? conn.resume[adapter.id] : undefined;
  if (adapter.protocol === "acp") {
    try {
      const acpArgs = [
        ...(adapter.acpArgs || ["acp"]),
        ...(chosen ? ["--model", chosen] : []),
      ];
      if (!conn.acp || conn.acpAdapter !== adapter.id || conn.acpModel !== (chosen || null)) {
        conn.acp?.dispose();
        conn.acp = await startAcp({
          bin,
          args: acpArgs,
          cwd: conn.workspace,
          mode: conn.mode,
          model: chosen,
          onEvent,
          onPermission: ask,
        });
        conn.acpAdapter = adapter.id;
        conn.acpModel = chosen || null;
      }
      await conn.acp.prompt(text, conn.mode);
      return true;
    } catch (e) {
      conn.acp?.dispose();
      conn.acp = null;
      conn.acpAdapter = null;
      conn.acpModel = null;
      if (!adapter.fallbackParser) throw e;
      onEvent({ type: "log", text: `ACP failed, falling back to headless: ${String((e as Error).message)}` });
      const spec = headlessSpec(
        adapter.id,
        {
          mode: conn.mode,
          permission: conn.permission,
          resumeId,
          model: chosen,
        },
        text,
      );
      await runHeadless({
        bin,
        args: spec.args,
        cwd: conn.workspace,
        parser: adapter.fallbackParser,
        stdinText: spec.stdin,
        keepStdin: spec.keepStdin,
        onEvent,
        onPermission: ask,
        signal: conn.abort?.signal,
      }).then((r) => {
        if (r.sessionId) conn.resume[adapter.id] = r.sessionId;
      });
      return false;
    }
  }

  const spec = headlessSpec(
    adapter.id,
    {
      mode: conn.mode,
      permission: conn.permission,
      resumeId,
      model: chosen,
    },
    text,
  );
  const r = await runHeadless({
    bin,
    args: spec.args,
    cwd: conn.workspace,
    parser: adapter.parser as Parser,
    stdinText: spec.stdin,
    keepStdin: spec.keepStdin,
    onEvent,
    onPermission: ask,
    signal: conn.abort?.signal,
  });
  if (r.sessionId) conn.resume[adapter.id] = r.sessionId;
  return false;
}

function decidePermission(conn: Conn, req: Extract<StreamEvent, { type: "permission" }>): Promise<PermDecision> {
  const yoloOrAuto = conn.permission === "yolo" || conn.permission === "auto";
  if (req.kind === "question") {
    emit(conn, req);
    return waitPerm(conn, req.requestId);
  }
  if (yoloOrAuto && req.kind !== "plan") {
    const always = req.options.find((o) => o.optionId.includes("always"))?.optionId;
    const once = req.options.find((o) => /allow|accept/i.test(o.optionId))?.optionId;
    return Promise.resolve({ optionId: always || once || req.options[0]?.optionId || "allow-always" });
  }
  if (yoloOrAuto && req.kind === "plan") {
    const accept = req.options.find((o) => /accept|allow/i.test(o.optionId))?.optionId;
    return Promise.resolve({ optionId: accept || "accept" });
  }
  emit(conn, req);
  return waitPerm(conn, req.requestId);
}

function waitPerm(conn: Conn, requestId: string): Promise<PermDecision> {
  return new Promise((resolve) => {
    conn.pendingPerm.set(requestId, resolve);
    setTimeout(() => {
      if (conn.pendingPerm.has(requestId)) {
        conn.pendingPerm.delete(requestId);
        resolve({ optionId: "reject-once" });
      }
    }, 300_000);
  });
}

const port = Number(process.env.PORT) || 5173;
httpServer.listen(port, "127.0.0.1", () => {
  console.log(`Local AI  http://127.0.0.1:${port}`);
});
