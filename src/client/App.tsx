import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AdapterId,
  AdapterStatus,
  ChatTurn,
  ClientMsg,
  Mode,
  PermDecision,
  Permission,
  ServerMsg,
  Skill,
  StreamEvent,
  TodoItem,
} from "../shared.ts";

type Tool = { id: string; name: string; detail?: string; done: boolean };
type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thought?: string;
  activity?: string;
  tools: Tool[];
  todos?: TodoItem[];
  plan?: string;
  streaming?: boolean;
};
type SideErr = { id: string; kind: "error" | "log"; text: string };

const MODES: Mode[] = ["agent", "plan", "ask"];
const PERMS: Permission[] = ["ask", "auto", "yolo"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function useSplit(key: string, init: number) {
  const [n, setN] = useState(() => {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 80 ? v : init;
  });
  useEffect(() => localStorage.setItem(key, String(n)), [key, n]);
  return [n, setN] as const;
}

export function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [draft, setDraft] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [memory, setMemory] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [statusErr, setStatusErr] = useState("");
  const [adapterId, setAdapterId] = useState<AdapterId>("cursor");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  const [permission, setPermission] = useState<Permission>("ask");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<Extract<StreamEvent, { type: "permission" }> | null>(null);
  const [diff, setDiff] = useState({ status: "", patch: "" });
  const [errs, setErrs] = useState<SideErr[]>([]);
  const [browse, setBrowse] = useState<{ path: string; dirs: string[]; parent: string | null } | null>(null);
  const [drawer, setDrawer] = useState<"diff" | "errors" | "memory" | "skills">("diff");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftW, setLeftW] = useSplit("lai.left", 240);
  const [rightW, setRightW] = useSplit("lai.right", 300);
  const [compH, setCompH] = useSplit("lai.composer", 148);
  const hydratedWs = useRef("");
  const autoLogin = useRef(new Set<AdapterId>());

  const send = (msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  };

  function applyStatus(msg: Extract<ServerMsg, { type: "status" }>) {
    setAdapters(msg.adapters);
    setWorkspace(msg.workspace);
    setDraft(msg.workspace);
    setMemory(msg.memory);
    setSkills(msg.skills);
    setRecent(msg.recent);
    setStatusErr(msg.error || "");
    if (msg.workspace !== hydratedWs.current) {
      hydratedWs.current = msg.workspace;
      setMessages(
        (msg.chat || []).map((t: ChatTurn) => ({
          id: crypto.randomUUID(),
          role: t.role,
          text: t.text,
          tools: [],
        })),
      );
    }
    const first = msg.adapters.find((a) => a.bin);
    if (first) setAdapterId((id) => (msg.adapters.some((a) => a.id === id && a.bin) ? id : first.id));
  }

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((msg: ServerMsg) => {
        if (msg.type === "status") applyStatus(msg);
      })
      .catch(() => {});
    let closed = false;
    const connect = () => {
      if (closed) return;
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/hub`);
      wsRef.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ type: "hello" } satisfies ClientMsg));
      };
      sock.onclose = () => {
        if (closed) return;
        setConnected(false);
        setTimeout(connect, 1000);
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (msg.type === "status") applyStatus(msg);
        else if (msg.type === "ls") setBrowse(msg);
        else if (msg.type === "diff") setDiff(msg);
        else if (msg.type === "event") onEvent(msg.event);
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, perm]);

  useEffect(() => {
    const a = adapters.find((x) => x.id === adapterId);
    if (!a) return;
    setModel((m) => (a.models.includes(m) ? m : a.model || a.models[0] || ""));
    if (!connected) return;
    if (a.bin && a.hasLogin && a.loggedIn === false && !autoLogin.current.has(a.id)) {
      autoLogin.current.add(a.id);
      send({ type: "login", adapterId: a.id });
    }
  }, [adapterId, adapters, connected]);

  function pushSide(kind: "error" | "log", text: string) {
    const t = text.trim();
    if (!t) return;
    setErrs((e) => [...e.slice(-80), { id: crypto.randomUUID(), kind, text: t }]);
    if (kind === "error") {
      setDrawer("errors");
      setRightOpen(true);
    }
  }

  function onEvent(e: StreamEvent) {
    if (e.type === "permission") {
      setPerm(e);
      return;
    }
    if (e.type === "log") {
      pushSide("log", e.text);
      return;
    }
    if (e.type === "activity") {
      setMessages((m) => {
        const copy = [...m];
        let idx = -1;
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant" && copy[i].streaming) {
            idx = i;
            break;
          }
        }
        if (idx < 0) {
          copy.push({ id: crypto.randomUUID(), role: "assistant", text: "", tools: [], streaming: true, activity: e.text });
          return copy;
        }
        copy[idx] = { ...copy[idx], activity: e.text };
        return copy;
      });
      return;
    }
    if (e.type === "done") {
      setBusy(false);
      setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
      return;
    }
    if (e.type === "error") {
      setBusy(false);
      setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
      pushSide("error", e.message);
      return;
    }
    setMessages((m) => {
      const copy = [...m];
      let idx = -1;
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant" && copy[i].streaming) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        copy.push({ id: crypto.randomUUID(), role: "assistant", text: "", tools: [], streaming: true });
        idx = copy.length - 1;
      }
      const last = { ...copy[idx], tools: [...copy[idx].tools] };
      if (e.type === "text_delta") last.text += e.text;
      if (e.type === "thought") last.thought = (last.thought || "") + e.text;
      if (e.type === "tool_start") {
        last.tools = [...last.tools.filter((t) => t.id !== e.id), { id: e.id, name: e.name, detail: e.detail, done: false }];
      }
      if (e.type === "tool_end") {
        last.tools = last.tools.map((t) =>
          t.id === e.id || t.name === e.name ? { ...t, done: true, detail: e.detail || t.detail } : t,
        );
      }
      if (e.type === "todo") {
        last.todos = e.items;
        last.plan = e.plan || last.plan;
      }
      copy[idx] = last;
      return copy;
    });
  }

  const selected = adapters.find((a) => a.id === adapterId);
  const needsSetup = !!selected && (!selected.bin || (selected.hasLogin && selected.loggedIn === false));
  const canSend = connected && !busy && (needsSetup || (!!selected?.bin && !!workspace && !statusErr && !!input.trim()));

  function submit() {
    if (!selected) return;
    if (!selected.bin) {
      send({ type: "openSite", adapterId });
      return;
    }
    if (selected.hasLogin && selected.loggedIn === false) {
      send({ type: "login", adapterId });
      return;
    }
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setPerm(null);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text, tools: [] },
      { id: crypto.randomUUID(), role: "assistant", text: "", tools: [], streaming: true },
    ]);
    send({ type: "prompt", adapterId, text, mode, permission, model: model || undefined });
  }

  const foundCount = adapters.filter((a) => a.bin).length;
  const changedFiles = diff.status.trim().split("\n").filter(Boolean);
  const errCount = errs.filter((e) => e.kind === "error").length;

  const emptyHint = useMemo(() => {
    if (!connected) return "Connecting to local hub…";
    if (!foundCount) return "Install a model CLI from its official site. This app uses your account, not a shared API key.";
    if (!workspace || statusErr) return "Pick a workspace folder to let the agent touch files.";
    if (!selected?.bin) return `${selected?.name || "This agent"} is not installed yet.`;
    if (selected.hasLogin && selected.loggedIn === false) return `Sign in to ${selected.name} with your own account.`;
    return "Ask it to inspect, plan, or change code in this folder.";
  }, [connected, foundCount, workspace, statusErr, selected]);

  return (
    <div className="relative flex h-full min-h-0">
      {leftOpen ? (
        <aside className="flex shrink-0 flex-col border-r border-line bg-bg1" style={{ width: leftW }}>
          <div className="flex h-10 items-center justify-between px-3">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-bad"}`} />
              Local AI
            </div>
            <button className="text-muted hover:text-text" title="Close sidebar" onClick={() => setLeftOpen(false)}>
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted">Workspace</label>
            <div className="mt-1.5 flex gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send({ type: "setWorkspace", path: draft })}
                placeholder="C:\\src\\project"
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[11px] text-text"
              />
              <button
                title="Browse"
                className="h-8 rounded-md border border-line bg-bg2 px-2 text-xs text-muted hover:text-text"
                onClick={() => send({ type: "ls", path: draft || workspace || "." })}
              >
                …
              </button>
            </div>
            {statusErr && <p className="mt-1 text-[11px] text-bad">{statusErr}</p>}
            {recent.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {recent.map((p) => (
                  <button
                    key={p}
                    onClick={() => send({ type: "setWorkspace", path: p })}
                    className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[10px] text-muted hover:bg-bg2 hover:text-text"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      ) : (
        <button
          className="flex w-8 shrink-0 items-start justify-center border-r border-line bg-bg1 pt-3 text-muted hover:text-text"
          title="Open workspace"
          onClick={() => setLeftOpen(true)}
        >
          ›
        </button>
      )}
      {leftOpen && <Split onDelta={(dx) => setLeftW((w) => clamp(w + dx, 180, 520))} />}

      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <div className="min-w-0 truncate font-mono text-[11px] text-muted">{workspace || "no workspace"}</div>
          {!rightOpen && (
            <button className="text-xs text-muted hover:text-text" onClick={() => setRightOpen(true)}>
              Panel
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {messages.length === 0 ? (
            <Empty hint={emptyHint} adapters={adapters} selected={selected} send={send} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) => (
                <Message key={m.id} msg={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {perm && <PermAsk perm={perm} send={send} onDone={() => setPerm(null)} />}

        <div className="relative shrink-0 border-t border-line px-4 pb-3 pt-2">
          <Split axis="y" onDelta={(dy) => setCompH((h) => clamp(h - dy, 100, 420))} />
          {selected && (!selected.bin || (selected.hasLogin && selected.loggedIn === false)) && (
            <SetupAsk agent={selected} send={send} />
          )}
          <div className="mx-auto flex max-w-3xl flex-col rounded-xl border border-line bg-bg1" style={{ height: compH }}>
            <textarea
              value={input}
              aria-label="Prompt"
              placeholder={
                !selected?.bin
                  ? `Install ${selected?.name || "an agent"} from its site, then refresh`
                  : selected.hasLogin && selected.loggedIn === false
                    ? `Sign in to ${selected.name} to chat`
                    : `Message ${selected.name}…`
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="min-h-0 flex-1 resize-none bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed text-text placeholder:text-muted"
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-2 py-1.5">
              <label className="sr-only" htmlFor="agent-select">
                Agent
              </label>
              <select
                id="agent-select"
                value={adapterId}
                onChange={(e) => setAdapterId(e.target.value as AdapterId)}
                className="h-7 rounded-md border border-line bg-bg2 px-1.5 text-[11px]"
              >
                {adapters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.bin ? "" : " — not installed"}
                  </option>
                ))}
              </select>
              {selected && selected.models.length > 0 && (
                <select
                  aria-label="Model"
                  value={model}
                  onChange={(e) => {
                    const v = e.target.value;
                    setModel(v);
                    send({ type: "setModel", adapterId, model: v });
                  }}
                  className="h-7 max-w-[160px] rounded-md border border-line bg-bg2 px-1.5 text-[11px]"
                >
                  {selected.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              <Seg value={mode} options={MODES} onChange={setMode} />
              <Seg value={permission} options={PERMS} onChange={setPermission} />
              <button className="text-[11px] text-muted hover:text-text" title="Refresh CLIs" onClick={() => send({ type: "detect" })}>
                ↻
              </button>
              <div className="flex-1" />
              {busy ? (
                <button
                  className="h-7 rounded-md bg-bad/20 px-3 text-[11px] text-bad"
                  onClick={() => {
                    send({ type: "cancel" });
                    setBusy(false);
                  }}
                >
                  Stop
                </button>
              ) : (
                <button
                  disabled={!canSend}
                  onClick={submit}
                  className="h-7 rounded-md bg-accent px-3 text-[11px] font-medium text-bg disabled:opacity-30"
                >
                  {needsSetup ? (!selected?.bin ? "Install" : "Sign in") : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {rightOpen && <Split onDelta={(dx) => setRightW((w) => clamp(w - dx, 220, 640))} />}
      {rightOpen ? (
        <aside className="flex shrink-0 flex-col border-l border-line bg-bg1" style={{ width: rightW }}>
          <div className="flex h-10 items-center gap-0.5 border-b border-line px-1">
            {(
              [
                ["diff", "Changed"],
                ["errors", errCount ? `Errors (${errCount})` : "Errors"],
                ["memory", "Memory"],
                ["skills", "Skills"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setDrawer(id)}
                className={`rounded px-2 py-1 text-[11px] ${drawer === id ? "bg-bg2 text-text" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
            <button className="ml-auto px-2 text-muted hover:text-text" title="Close panel" onClick={() => setRightOpen(false)}>
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {drawer === "diff" && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">This turn</div>
                {changedFiles.length === 0 ? (
                  <p className="text-sm text-muted">No files the agent touched this turn.</p>
                ) : (
                  <ul className="space-y-1 font-mono text-[11px]">
                    {changedFiles.map((f) => (
                      <li key={f} className="text-ok">
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                {diff.patch && (
                  <pre className="mt-3 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[10px] leading-4 text-muted">
                    {diff.patch}
                  </pre>
                )}
              </div>
            )}
            {drawer === "errors" && (
              <div>
                {errs.length === 0 ? (
                  <p className="text-sm text-muted">No errors this session.</p>
                ) : (
                  <ul className="space-y-2 font-mono text-[11px] leading-4">
                    {errs.map((e) => (
                      <li key={e.id} className={e.kind === "error" ? "text-bad" : "text-muted"}>
                        {e.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {drawer === "memory" && (
              <div className="flex h-full flex-col">
                <p className="mb-2 text-[11px] text-muted">
                  Stored in <span className="font-mono">~/.local-ai/MEMORY.md</span>. Every agent in this chat reads it.
                </p>
                <textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  className="min-h-48 flex-1 rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-5"
                />
                <button className="mt-2 rounded-md bg-bg2 px-3 py-1.5 text-xs" onClick={() => send({ type: "saveMemory", text: memory })}>
                  Save memory
                </button>
              </div>
            )}
            {drawer === "skills" && (
              <div>
                <p className="mb-3 text-[11px] text-muted">
                  SKILL.md folders in <span className="font-mono">~/.local-ai/skills</span>
                </p>
                {skills.length === 0 ? (
                  <p className="text-sm text-muted">No skills yet. Add a folder with SKILL.md.</p>
                ) : (
                  <ul className="space-y-2">
                    {skills.map((s) => (
                      <li key={s.id} className="rounded-lg border border-line bg-bg p-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={s.enabled}
                            onChange={(e) => send({ type: "toggleSkill", id: s.id, enabled: e.target.checked })}
                          />
                          {s.name}
                        </label>
                        <p className="mt-1 text-[11px] text-muted">{s.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {browse && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => setBrowse(null)}>
          <div className="w-[480px] rounded-2xl border border-line bg-bg1 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="truncate font-mono text-[11px] text-muted">{browse.path}</div>
              <button className="text-xs text-muted" onClick={() => setBrowse(null)}>
                Close
              </button>
            </div>
            {browse.parent && (
              <button
                className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-bg2"
                onClick={() => send({ type: "ls", path: browse.parent! })}
              >
                ..
              </button>
            )}
            <div className="max-h-80 overflow-auto">
              {browse.dirs.map((d) => (
                <div key={d} className="flex items-center justify-between rounded px-2 py-1 hover:bg-bg2">
                  <button className="truncate text-left text-sm" onClick={() => send({ type: "ls", path: d })}>
                    {d.replace(/\\/g, "/").split("/").pop()}
                  </button>
                  <button
                    className="text-[11px] text-accent"
                    onClick={() => {
                      send({ type: "setWorkspace", path: d });
                      setBrowse(null);
                    }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Split({ onDelta, axis = "x" }: { onDelta: (d: number) => void; axis?: "x" | "y" }) {
  return (
    <div
      role="separator"
      className={axis === "x" ? "split-x" : "split-y"}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        let last = axis === "x" ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const now = axis === "x" ? ev.clientX : ev.clientY;
          onDelta(now - last);
          last = now;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

function PermAsk({
  perm,
  send,
  onDone,
}: {
  perm: Extract<StreamEvent, { type: "permission" }>;
  send: (msg: ClientMsg) => void;
  onDone: () => void;
}) {
  const questions = perm.questions || [];
  const [picks, setPicks] = useState<Record<string, string>>({});
  const decide = (d: PermDecision) => {
    send({ type: "permission", requestId: perm.requestId, optionId: d.optionId, answers: d.answers });
    onDone();
  };
  const allPicked = questions.length > 0 && questions.every((q) => picks[q.id] || q.options.length === 0);

  return (
    <div className="mx-4 mb-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3">
      <div className="text-sm font-medium text-warn">{perm.title}</div>
      {perm.detail && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{perm.detail}</pre>
      )}
      {questions.length > 0 ? (
        <div className="mt-3 space-y-3">
          {questions.map((q) => (
            <div key={q.id}>
              <div className="text-sm">{q.prompt}</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <button
                    key={o.optionId}
                    className={`rounded-md border px-3 py-1 text-xs ${
                      picks[q.id] === o.optionId ? "border-accent bg-accent/15" : "border-line bg-bg2 hover:border-accent/50"
                    }`}
                    onClick={() => setPicks((p) => ({ ...p, [q.id]: o.optionId }))}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            disabled={!allPicked}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-30"
            onClick={() =>
              decide({
                optionId: Object.values(picks)[0] || "answered",
                answers: questions.map((q) => ({ questionId: q.id, selectedOptionIds: picks[q.id] ? [picks[q.id]] : [] })),
              })
            }
          >
            Submit answers
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {perm.options.map((o) => (
            <button
              key={o.optionId}
              className="rounded-md border border-line bg-bg2 px-3 py-1 text-xs hover:border-accent/50"
              onClick={() => decide({ optionId: o.optionId })}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded px-1.5 py-0.5 text-[11px] capitalize ${value === o ? "bg-bg3 text-text" : "text-muted"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SetupAsk({
  agent,
  send,
}: {
  agent: AdapterStatus;
  send: (msg: ClientMsg) => void;
}) {
  const missing = !agent.bin;
  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-start justify-between gap-3 rounded-xl border border-line bg-bg1 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">
          {missing ? `Install ${agent.name} to continue` : `Sign in to ${agent.name}`}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          {missing
            ? "This hub uses the official CLI and your own account. Open the vendor site, install, then refresh."
            : "A sign-in window should open. Finish there, then refresh."}
        </p>
        {missing && <code className="mt-1.5 block truncate font-mono text-[10px] text-warn">{agent.install}</code>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {missing ? (
          <>
            <button
              className="h-7 rounded-md bg-accent px-2.5 text-[11px] font-medium text-bg"
              onClick={() => send({ type: "openSite", adapterId: agent.id })}
            >
              Open site
            </button>
            <button
              className="h-7 rounded-md border border-line px-2.5 text-[11px] text-muted hover:text-text"
              onClick={() => navigator.clipboard.writeText(agent.install).catch(() => {})}
            >
              Copy command
            </button>
          </>
        ) : (
          <button
            className="h-7 rounded-md bg-accent px-2.5 text-[11px] font-medium text-bg"
            onClick={() => send({ type: "login", adapterId: agent.id })}
          >
            Sign in
          </button>
        )}
        <button
          className="h-7 rounded-md border border-line px-2.5 text-[11px] text-muted hover:text-text"
          onClick={() => send({ type: "detect" })}
        >
          I’ve done this
        </button>
      </div>
    </div>
  );
}

function Empty({
  hint,
  adapters,
  selected,
  send,
}: {
  hint: string;
  adapters: AdapterStatus[];
  selected?: AdapterStatus;
  send: (msg: ClientMsg) => void;
}) {
  const needsSetup = adapters.filter((a) => !a.bin || (a.hasLogin && a.loggedIn === false));
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start pt-16">
      <h1 className="text-2xl font-medium tracking-tight">What should we do?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{hint}</p>
      {needsSetup.length > 0 && (
        <ul className="mt-5 w-full space-y-2">
          {needsSetup.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg1 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13px]">{a.name}</div>
                <div className="truncate font-mono text-[10px] text-muted">{a.bin ? "Signed out" : a.install}</div>
              </div>
              <button
                className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg"
                onClick={() =>
                  send(a.bin ? { type: "login", adapterId: a.id } : { type: "openSite", adapterId: a.id })
                }
              >
                {a.bin ? "Sign in" : "Install"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && !needsSetup.length && (
        <p className="mt-4 text-[12px] text-muted">Using {selected.name}. Type below to start.</p>
      )}
    </div>
  );
}

function Message({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-bg2 px-4 py-2.5 text-[14px] leading-relaxed">{msg.text}</div>
      </div>
    );
  }
  return (
    <div>
      {msg.activity && msg.streaming && (
        <div className="mb-1 text-[11px] text-muted">{msg.activity}</div>
      )}
      {msg.streaming && !msg.text && !msg.thought && <div className="think think-live mb-2">Thinking</div>}
      {msg.thought && (
        <details className="think mb-2" open={!!msg.streaming}>
          <summary>{msg.streaming ? "Thinking" : "Thought"}</summary>
          <div className="think-body">{msg.thought}</div>
        </details>
      )}
      {msg.tools.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {msg.tools.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg1 px-2 py-0.5 font-mono text-[10px] text-muted"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${t.done ? "bg-ok" : "animate-pulse bg-accent"}`} />
              {t.name}
              {t.detail ? <span className="max-w-[180px] truncate opacity-70">{t.detail}</span> : null}
            </span>
          ))}
        </div>
      )}
      {msg.plan && <div className="mb-2 rounded-lg border border-line bg-bg1 p-3 text-[12px] text-muted">{msg.plan}</div>}
      {msg.todos && msg.todos.length > 0 && (
        <ul className="mb-2 space-y-1 text-[12px] text-muted">
          {msg.todos.map((t) => (
            <li key={t.id}>
              <span className={t.status === "completed" ? "text-ok" : ""}>{t.status === "completed" ? "✓" : "○"}</span> {t.content}
            </li>
          ))}
        </ul>
      )}
      <div className="prose-chat text-[14.5px] leading-[1.65]">
        <Md text={msg.text} />
        {msg.streaming && !msg.thought && <span className="ml-0.5 inline-block h-[0.85em] w-px bg-muted/70 align-middle" />}
      </div>
    </div>
  );
}

function Md({ text }: { text: string }) {
  if (!text) return null;
  const chunks: { kind: "code" | "p"; lang?: string; body: string }[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) chunks.push({ kind: "p", body: text.slice(last, m.index) });
    chunks.push({ kind: "code", lang: m[1], body: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) chunks.push({ kind: "p", body: text.slice(last) });
  return (
    <>
      {chunks.map((c, i) =>
        c.kind === "code" ? (
          <pre key={i}>
            <code>{c.body}</code>
          </pre>
        ) : (
          <p key={i} dangerouslySetInnerHTML={{ __html: inline(c.body) }} />
        ),
      )}
    </>
  );
}

function inline(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
