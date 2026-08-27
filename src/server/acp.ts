import readline from "node:readline";
import type { Mode, PermDecision, StreamEvent } from "../shared.ts";
import { killTree, spawnCli } from "./adapters.ts";

export type AcpSession = {
  sessionId: string;
  prompt: (text: string, mode: Mode) => Promise<void>;
  cancel: () => void;
  dispose: () => void;
};

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

export function startAcp(opts: {
  bin: string;
  args: string[];
  cwd: string;
  mode: Mode;
  model?: string;
  onEvent: (e: StreamEvent) => void;
  onPermission: (req: Extract<StreamEvent, { type: "permission" }>) => Promise<PermDecision>;
}): Promise<AcpSession> {
  const child = spawnCli(opts.bin, opts.args, opts.cwd);
  let nextId = 1;
  const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let closed = false;
  let sessionId = "";
  let currentMode = opts.mode;

  const send = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) return reject(new Error("ACP process exited"));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  const respond = (id: unknown, result: unknown) => {
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  };

  const failAll = (err: Error) => {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  child.on("error", (e) => {
    opts.onEvent({ type: "error", message: e.message });
    failAll(e);
  });
  child.on("exit", (code) => {
    failAll(new Error(code ? `ACP exited ${code}` : "ACP exited"));
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const t = buf.toString();
    if (t.trim()) opts.onEvent({ type: "log", text: t });
  });

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", async (line) => {
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return;
    }
    if (msg.id != null && !msg.method) {
      const waiter = pending.get(msg.id as string | number);
      if (!waiter) return;
      pending.delete(msg.id as string | number);
      if (msg.error) {
        const err = asRecord(msg.error);
        waiter.reject(new Error(String(err?.message || JSON.stringify(msg.error))));
      } else waiter.resolve(msg.result);
      return;
    }
    const method = String(msg.method || "");
    if (method === "session/update") mapUpdate(asRecord(msg.params), opts.onEvent);
    else if (method === "session/request_permission") {
      const params = asRecord(msg.params) || {};
      const tool = asRecord(params.toolCall);
      const rawOpts = Array.isArray(params.options) ? params.options : [];
      const options = rawOpts
        .map((o) => {
          const r = asRecord(o);
          return r ? { optionId: String(r.optionId || r.id || ""), name: String(r.name || r.optionId || "") } : null;
        })
        .filter((o): o is { optionId: string; name: string } => !!o && !!o.optionId);
      const fallback = [
        { optionId: "allow-once", name: "Allow once" },
        { optionId: "allow-always", name: "Always allow" },
        { optionId: "reject-once", name: "Reject" },
      ];
      const decision = await opts.onPermission({
        type: "permission",
        kind: "tool",
        requestId: String(msg.id),
        title: String(tool?.title || tool?.kind || params.title || "Allow this tool?"),
        detail: locations(tool || {}) || undefined,
        options: options.length ? options : fallback,
      });
      respond(msg.id, { outcome: { outcome: "selected", optionId: decision.optionId } });
    } else if (method === "cursor/create_plan") {
      const params = asRecord(msg.params) || {};
      const todos = Array.isArray(params.todos) ? params.todos : [];
      opts.onEvent({
        type: "todo",
        plan: String(params.plan || params.overview || ""),
        items: todos.map((t, i) => {
          const r = asRecord(t);
          return {
            id: String(r?.id || i),
            content: String(r?.content || ""),
            status: String(r?.status || "pending"),
          };
        }),
      });
      const decision = await opts.onPermission({
        type: "permission",
        kind: "plan",
        requestId: String(msg.id),
        title: String(params.name || "Approve this plan?"),
        detail: String(params.plan || params.overview || ""),
        options: [
          { optionId: "accept", name: "Accept plan" },
          { optionId: "reject", name: "Reject" },
        ],
      });
      respond(msg.id, {
        outcome: { outcome: decision.optionId === "accept" ? "accepted" : "rejected" },
      });
    } else if (method === "cursor/ask_question") {
      const params = asRecord(msg.params) || {};
      const rawQs = Array.isArray(params.questions) ? params.questions : [];
      const questions = rawQs.map((q, i) => {
        const r = asRecord(q);
        const optsQ = Array.isArray(r?.options) ? r!.options : [];
        return {
          id: String(r?.id || i),
          prompt: String(r?.prompt || r?.question || "Question"),
          options: optsQ
            .map((o) => {
              const x = asRecord(o);
              return x ? { optionId: String(x.id || x.optionId || ""), name: String(x.label || x.name || "") } : null;
            })
            .filter((o): o is { optionId: string; name: string } => !!o && !!o.optionId),
        };
      });
      const decision = await opts.onPermission({
        type: "permission",
        kind: "question",
        requestId: String(msg.id),
        title: String(params.title || questions[0]?.prompt || "The agent has a question"),
        options: questions[0]?.options || [],
        questions,
      });
      const answers =
        decision.answers ||
        questions.map((q) => ({
          questionId: q.id,
          selectedOptionIds: [decision.optionId],
        }));
      respond(msg.id, { outcome: { outcome: "answered", answers } });
    } else if (method === "cursor/update_todos") {
      const params = asRecord(msg.params) || {};
      const todos = Array.isArray(params.todos) ? params.todos : [];
      opts.onEvent({
        type: "todo",
        items: todos.map((t, i) => {
          const r = asRecord(t);
          return {
            id: String(r?.id || i),
            content: String(r?.content || ""),
            status: String(r?.status || "pending"),
          };
        }),
      });
      if (msg.id != null) respond(msg.id, {});
    } else if (msg.id != null) {
      child.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${method}` } }) +
          "\n",
      );
    }
  });

  return (async () => {
    const init = asRecord(
      await send("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "local-ai", version: "0.1.0" },
      }),
    );
    const methods = Array.isArray(init?.authMethods) ? init!.authMethods : [];
    if (methods.length) {
      const first = asRecord(methods[0]);
      const login = methods.map(asRecord).find((m) => String(m?.id || "").includes("login"));
      const methodId = String(login?.id || first?.id || "");
      if (methodId) await send("authenticate", { methodId }).catch(() => {});
    }
    const created = asRecord(
      await send("session/new", {
        cwd: opts.cwd,
        mcpServers: [],
        ...(opts.model && opts.model !== "auto" ? { model: opts.model } : {}),
      }),
    );
    sessionId = String(created?.sessionId || created?.session_id || "");
    if (!sessionId) throw new Error("ACP session/new returned no sessionId");
    if (opts.model && opts.model !== "auto") {
      await send("session/set_model", { sessionId, modelId: opts.model }).catch(() => {});
    }
    if (currentMode !== "agent") {
      await send("session/set_mode", { sessionId, modeId: currentMode }).catch(() => {});
    }
    return {
      sessionId,
      async prompt(text: string, mode: Mode) {
        if (mode !== currentMode) {
          currentMode = mode;
          await send("session/set_mode", { sessionId, modeId: mode }).catch(() => {});
        }
        await send("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
      },
      cancel() {
        send("session/cancel", { sessionId }).catch(() => {});
      },
      dispose() {
        closed = true;
        killTree(child);
      },
    };
  })();
}

function mapUpdate(params: Json | null, onEvent: (e: StreamEvent) => void) {
  const update = asRecord(params?.update) || params;
  if (!update) return;
  const kind = String(update.sessionUpdate || update.type || "");
  const content = asRecord(update.content);
  const text = String(
    (typeof update.content === "string" ? update.content : null) ||
      content?.text ||
      content?.thought ||
      update.text ||
      update.thought ||
      "",
  );
  const contentType = String(content?.type || "");
  if (kind === "agent_thought_chunk" || contentType === "thought" || contentType === "thinking") {
    if (text) onEvent({ type: "thought", text });
    return;
  }
  if (kind === "agent_message_chunk" || kind === "message") {
    if (text) onEvent({ type: "text_delta", text });
    return;
  }
  if (kind === "tool_call") {
    onEvent({
      type: "tool_start",
      id: String(update.toolCallId || update.toolCallId === 0 ? update.toolCallId : update.id || update.title || "tool"),
      name: String(update.title || update.kind || update.name || "tool"),
      detail: locations(update),
    });
    return;
  }
  if (kind === "tool_call_update") {
    const status = String(update.status || "");
    if (status === "completed" || status === "failed") {
      onEvent({
        type: "tool_end",
        id: String(update.toolCallId || update.id || "tool"),
        name: String(update.title || update.kind || "tool"),
        detail: status === "failed" ? "failed" : undefined,
      });
    }
  }
}

function locations(update: Json): string | undefined {
  const locs = update.locations;
  if (!Array.isArray(locs) || !locs[0]) return undefined;
  const first = asRecord(locs[0]);
  return first?.path ? String(first.path) : undefined;
}
