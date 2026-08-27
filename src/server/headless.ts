import readline from "node:readline";
import type { PermDecision, StreamEvent } from "../shared.ts";
import { killTree, spawnCli } from "./adapters.ts";
import type { Parser } from "./adapters.ts";

type Json = Record<string, unknown>;

function rec(v: unknown): Json | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

export function parseClaudeControl(line: string): { requestId: string; title: string; detail?: string } | null {
  let j: Json;
  try {
    j = JSON.parse(line) as Json;
  } catch {
    return null;
  }
  if (j.type !== "control_request") return null;
  const req = rec(j.request) || {};
  const requestId = String(j.request_id || j.requestId || "");
  if (!requestId) return null;
  const tool = String(req.tool_name || req.toolName || req.subtype || "tool");
  const input = req.input != null ? JSON.stringify(req.input).slice(0, 400) : undefined;
  return { requestId, title: `Allow ${tool}?`, detail: input };
}

export function parseClaudeLine(line: string): StreamEvent[] {
  let j: Json;
  try {
    j = JSON.parse(line) as Json;
  } catch {
    return [];
  }
  const out: StreamEvent[] = [];
  const pushDelta = (delta: Json | null) => {
    if (!delta) return;
    if (delta.type === "text_delta" && delta.text) out.push({ type: "text_delta", text: String(delta.text) });
    if (delta.type === "thinking_delta" || delta.type === "thought_delta") {
      const t = String(delta.thinking || delta.text || "");
      if (t) out.push({ type: "thought", text: t });
    }
  };
  if (j.type === "system") {
    const sub = String(j.subtype || "");
    if (sub === "init") out.push({ type: "activity", text: "Claude started" });
    else if (sub === "status" && j.status) out.push({ type: "activity", text: String(j.status) });
  }
  if (j.type === "rate_limit_event") {
    const info = rec(j.rate_limit_info);
    out.push({ type: "activity", text: `rate limit: ${String(info?.status || "unknown")}` });
  }
  if (j.type === "stream_event") {
    const event = rec(j.event);
    pushDelta(rec(event?.delta));
    const block = rec(event?.content_block);
    if (event?.type === "content_block_start" && (block?.type === "thinking" || block?.type === "redacted_thinking")) {
      const t = String(block.thinking || block.text || "");
      if (t) out.push({ type: "thought", text: t });
    }
  }
  if (j.type === "content_block_delta") pushDelta(rec(j.delta));
  if (j.type === "assistant" && Array.isArray(j.message ? rec(j.message)?.content : null)) {
    for (const c of rec(j.message)!.content as unknown[]) {
      const block = rec(c);
      if (block?.type === "text" && block.text) out.push({ type: "text_delta", text: String(block.text) });
      if ((block?.type === "thinking" || block?.type === "redacted_thinking") && (block.thinking || block.text)) {
        out.push({ type: "thought", text: String(block.thinking || block.text) });
      }
      if (block?.type === "tool_use") {
        out.push({
          type: "tool_start",
          id: String(block.id || block.name),
          name: String(block.name || "tool"),
          detail: block.input ? JSON.stringify(block.input).slice(0, 240) : undefined,
        });
      }
    }
  }
  if (j.type === "content_block_start") {
    const block = rec(j.content_block);
    if (block?.type === "tool_use") {
      out.push({ type: "tool_start", id: String(block.id || block.name), name: String(block.name || "tool") });
    }
  }
  if (j.type === "user" && rec(j.message) && Array.isArray(rec(j.message)!.content)) {
    for (const c of rec(j.message)!.content as unknown[]) {
      const block = rec(c);
      if (block?.type === "tool_result") {
        out.push({ type: "tool_end", id: String(block.tool_use_id || ""), name: "tool" });
      }
    }
  }
  if (j.type === "result") {
    if (j.is_error) out.push({ type: "error", message: String(j.result || j.error || "failed") });
    else
      out.push({
        type: "done",
        sessionId: j.session_id ? String(j.session_id) : undefined,
        cost: typeof j.total_cost_usd === "number" ? j.total_cost_usd : undefined,
      });
  }
  if (j.type === "error") {
    const err = rec(j.error);
    out.push({ type: "error", message: String(err?.message || j.message || line) });
  }
  return out;
}

export function parseCodexLine(line: string): StreamEvent[] {
  let j: Json;
  try {
    j = JSON.parse(line) as Json;
  } catch {
    return [];
  }
  const out: StreamEvent[] = [];
  const t = String(j.type || rec(j.msg)?.type || "");
  const item = rec(j.item);
  if (t === "item.started" && item) {
    const name = String(item.type || item.name || "tool");
    if (name === "reasoning" || name === "agent_reasoning") {
      /* thought comes on completed */
    } else if (name !== "agent_message") {
      out.push({
        type: "tool_start",
        id: String(item.id || name),
        name,
        detail: String(item.command || item.path || item.text || "").slice(0, 240) || undefined,
      });
    }
  }
  if (t === "item.completed" && item) {
    if (item.type === "agent_message" && item.text) out.push({ type: "text_delta", text: String(item.text) });
    else if (item.type === "reasoning" || item.type === "agent_reasoning") {
      const text = String(item.text || item.content || "");
      if (text) out.push({ type: "thought", text });
    } else if (item.type && item.type !== "agent_message") {
      out.push({ type: "tool_end", id: String(item.id || item.type), name: String(item.type) });
    }
  }
  if (t === "agent_message" && j.text) out.push({ type: "text_delta", text: String(j.text) });
  if (t === "item.updated" && item && (item.type === "reasoning" || item.type === "agent_reasoning")) {
    const text = String(item.delta || item.text || "");
    if (text) out.push({ type: "thought", text });
  }
  if (t === "error" || j.error) {
    out.push({ type: "error", message: String(rec(j.error)?.message || j.message || "codex error") });
  }
  if (t === "turn.completed" || t === "task_complete") out.push({ type: "done" });
  return out;
}

export function parseTextChunk(chunk: string): StreamEvent[] {
  return chunk ? [{ type: "text_delta", text: chunk }] : [];
}

export async function runHeadless(opts: {
  bin: string;
  args: string[];
  cwd: string;
  parser: Parser;
  stdinText?: string;
  keepStdin?: boolean;
  onEvent: (e: StreamEvent) => void;
  onPermission?: (req: Extract<StreamEvent, { type: "permission" }>) => Promise<PermDecision>;
  signal?: AbortSignal;
}): Promise<{ sessionId?: string }> {
  const child = spawnCli(opts.bin, opts.args, opts.cwd);
  let sessionId: string | undefined;
  let sawStreamDelta = false;
  let sawDone = false;

  const kill = () => killTree(child);
  if (opts.signal?.aborted) kill();
  opts.signal?.addEventListener("abort", kill);

  const parse = (line: string): StreamEvent[] => {
    try {
      const j = JSON.parse(line) as Json;
      if (j.session_id) sessionId = String(j.session_id);
      if (j.thread_id) sessionId = String(j.thread_id);
    } catch {
      /* not json */
    }
    if (opts.parser === "claude") {
      const events = parseClaudeLine(line);
      return events.filter((e) => {
        if (e.type === "text_delta" || e.type === "thought") {
          if (sawStreamDelta && line.includes('"type":"assistant"')) return false;
          if (line.includes("stream_event") || line.includes("content_block_delta")) sawStreamDelta = true;
        }
        return true;
      });
    }
    if (opts.parser === "codex") return parseCodexLine(line);
    return parseTextChunk(line + "\n");
  };

  const emit = (events: StreamEvent[]) => {
    for (const e of events) {
      if (e.type === "done") {
        sawDone = true;
        if (e.sessionId) sessionId = e.sessionId;
        try {
          child.stdin?.end();
        } catch {
          /* closed */
        }
        opts.onEvent({ ...e, sessionId: e.sessionId || sessionId });
      } else opts.onEvent(e);
    }
  };

  child.stderr?.on("data", (buf: Buffer) => {
    const t = buf.toString();
    if (t.trim()) opts.onEvent({ type: "log", text: t });
  });

  const handleLine = async (line: string) => {
    const ctl = opts.keepStdin && opts.onPermission ? parseClaudeControl(line) : null;
    if (ctl) {
      const decision = await opts.onPermission!({
        type: "permission",
        kind: "tool",
        requestId: ctl.requestId,
        title: ctl.title,
        detail: ctl.detail,
        options: [
          { optionId: "allow-once", name: "Allow once" },
          { optionId: "reject-once", name: "Reject" },
        ],
      });
      const allow = /allow|accept/i.test(decision.optionId);
      try {
        child.stdin?.write(
          JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: ctl.requestId,
              response: allow
                ? { behavior: "allow" }
                : { behavior: "deny", message: "Rejected in workbench" },
            },
          }) + "\n",
        );
      } catch {
        /* stdin closed */
      }
      return;
    }
    emit(parse(line));
  };

  if (opts.parser === "text") {
    child.stdout?.on("data", (buf: Buffer) => emit(parseTextChunk(buf.toString())));
  } else {
    const rl = readline.createInterface({ input: child.stdout! });
    let queue = Promise.resolve();
    rl.on("line", (line) => {
      queue = queue.then(() => handleLine(line)).catch((e) => {
        opts.onEvent({ type: "error", message: String((e as Error).message || e) });
      });
    });
  }

  if (opts.stdinText !== undefined) child.stdin?.write(opts.stdinText);
  if (!opts.keepStdin) child.stdin?.end();

  const code: number | null = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (c) => resolve(c));
  });
  if (!sawDone) {
    if (code && code !== 0) opts.onEvent({ type: "error", message: `exited ${code}` });
    opts.onEvent({ type: "done", sessionId });
  }
  return { sessionId };
}
