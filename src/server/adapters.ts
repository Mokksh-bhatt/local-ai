import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { AdapterId, Mode, Permission } from "../shared.ts";

const execFileAsync = promisify(execFile);

export type Protocol = "acp" | "headless";
export type Parser = "claude" | "codex" | "text";

export type Adapter = {
  id: AdapterId;
  name: string;
  bins: string[];
  login: string[];
  install: string;
  site: string;
  protocol: Protocol;
  acpArgs?: string[];
  parser?: Parser;
  fallbackParser?: Parser;
};

export const adapters: Adapter[] = [
  {
    id: "cursor",
    name: "Cursor",
    bins: ["agent", "cursor-agent"],
    login: ["login"],
    install: "irm https://cursor.com/install?win32=true | iex",
    site: "https://cursor.com/download",
    protocol: "acp",
    acpArgs: ["acp"],
  },
  {
    id: "claude",
    name: "Claude",
    bins: ["claude"],
    login: ["auth", "login"],
    install: "npm i -g @anthropic-ai/claude-code",
    site: "https://code.claude.com/docs/en/overview",
    protocol: "headless",
    parser: "claude",
  },
  {
    id: "copilot",
    name: "Copilot",
    bins: ["copilot"],
    login: ["login", "--web-flow"],
    install: "npm i -g @github/copilot",
    site: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    protocol: "acp",
    acpArgs: ["--acp", "--stdio"],
    fallbackParser: "text",
  },
  {
    id: "codex",
    name: "Codex",
    bins: ["codex"],
    login: ["login"],
    install: "npm i -g @openai/codex",
    site: "https://developers.openai.com/codex/cli",
    protocol: "headless",
    parser: "codex",
  },
  {
    id: "aider",
    name: "Aider",
    bins: ["aider", "aider-chat"],
    login: [],
    install: "pip install aider-chat",
    site: "https://aider.chat",
    protocol: "headless",
    parser: "text",
  },
];

export async function findBin(names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync("where.exe", [name], { windowsHide: true });
        const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const hit = lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) || lines[0];
        if (hit) return hit;
      } else {
        const { stdout } = await execFileAsync("which", [name]);
        const hit = stdout.trim();
        if (hit) return hit;
      }
    } catch {
      /* missing */
    }
  }
  return null;
}

async function checkLogin(adapter: Adapter, bin: string): Promise<boolean | null> {
  if (!adapter.login.length) return null;
  if (adapter.id === "copilot") {
    if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
    try {
      const raw = fs
        .readFileSync(path.join(os.homedir(), ".copilot", "config.json"), "utf8")
        .replace(/^\s*\/\/.*$/gm, "");
      const j = JSON.parse(raw) as { lastLoggedInUser?: { login?: string }; loggedInUsers?: unknown[] };
      return !!(j.lastLoggedInUser?.login || j.loggedInUsers?.length);
    } catch {
      return false;
    }
  }
  if (adapter.id === "codex") {
    return fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"));
  }
  if (adapter.id === "claude") {
    try {
      const { stdout } = await execFileAsync(bin, ["auth", "status"], { windowsHide: true, timeout: 6000 });
      const m = stdout.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const j = JSON.parse(m[0]) as { loggedIn?: boolean };
      return typeof j.loggedIn === "boolean" ? j.loggedIn : null;
    } catch {
      return null;
    }
  }
  return null;
}

let detectCache: {
  at: number;
  data: { adapter: Adapter; bin: string | null; loggedIn: boolean | null; models: string[] }[];
} | null = null;

export function invalidateDetect() {
  detectCache = null;
}

export async function detect(): Promise<
  { adapter: Adapter; bin: string | null; loggedIn: boolean | null; models: string[] }[]
> {
  if (detectCache && Date.now() - detectCache.at < 8000) return detectCache.data;
  const out = await Promise.all(
    adapters.map(async (adapter) => {
      const bin = await findBin(adapter.bins);
      const loggedIn = bin ? await checkLogin(adapter, bin) : null;
      return { adapter, bin, loggedIn, models: bin ? listModels(adapter.id) : [] };
    }),
  );
  detectCache = { at: Date.now(), data: out };
  return out;
}

const q = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export function listModels(id: AdapterId): string[] {
  switch (id) {
    case "claude":
      return ["sonnet", "opus", "haiku", "fable"];
    case "copilot":
      return ["gpt-4.1", "gpt-5-mini", "gpt-5.4", "claude-sonnet-4.6", "claude-haiku-4.5", "claude-opus-4.6"];
    case "codex":
      return ["gpt-5", "o3", "o4-mini"];
    default:
      return [];
  }
}

export function spawnCli(bin: string, args: string[], cwd: string): ChildProcess {
  const env = { ...process.env, NO_COLOR: "1" };
  const stdio = ["pipe", "pipe", "pipe"] as const;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return spawn([q(bin), ...args.map(q)].join(" "), { cwd, env, shell: true, windowsHide: true, stdio });
  }
  return spawn(bin, args, { cwd, env, windowsHide: true, stdio });
}

export function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* gone */
  }
}

export function spawnLogin(bin: string, args: string[], cwd: string): ChildProcess {
  const inner = [q(bin), ...args.map(q)].join(" ");
  if (process.platform === "win32") {
    const child = spawn(`cmd.exe /c start "Local AI sign-in" cmd.exe /k ${inner}`, {
      cwd,
      shell: true,
      windowsHide: false,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child;
  }
  return spawnCli(bin, args, cwd);
}

export function openUrl(url: string) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/c", "start", "", url], { windowsHide: true, detached: true, stdio: "ignore" })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export type HeadlessSpec = { args: string[]; stdin?: string; keepStdin?: boolean };

export function headlessSpec(
  id: AdapterId,
  opts: { mode: Mode; permission: Permission; resumeId?: string; model?: string },
  prompt: string,
): HeadlessSpec {
  const model = opts.model && opts.model !== "auto" ? opts.model : undefined;
  switch (id) {
    case "claude": {
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--input-format",
        "stream-json",
      ];
      if (model) args.push("--model", model);
      if (opts.resumeId) args.push("--resume", opts.resumeId);
      if (opts.mode === "plan" || opts.mode === "ask") args.push("--permission-mode", "plan");
      else if (opts.permission === "yolo") args.push("--permission-mode", "bypassPermissions");
      else if (opts.permission === "ask") args.push("--permission-mode", "default");
      else args.push("--permission-mode", "acceptEdits");
      return {
        args,
        stdin:
          JSON.stringify({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: prompt }] },
          }) + "\n",
        keepStdin: opts.permission === "ask" && opts.mode === "agent",
      };
    }
    case "codex": {
      const sandbox =
        opts.mode === "plan" || opts.mode === "ask"
          ? (["--sandbox", "read-only"] as const)
          : opts.permission === "yolo"
            ? (["--sandbox", "danger-full-access", "--ask-for-approval", "never"] as const)
            : (["--sandbox", "workspace-write", "--ask-for-approval", "never"] as const);
      const modelArgs = model ? (["--model", model] as const) : ([] as const);
      if (opts.resumeId) return { args: ["exec", "resume", opts.resumeId, "--json", ...modelArgs, ...sandbox, "-"], stdin: prompt };
      return { args: ["exec", "--json", ...modelArgs, ...sandbox, "-"], stdin: prompt };
    }
    case "copilot": {
      const args = ["-p", prompt];
      if (model) args.push("--model", model);
      if (opts.permission !== "ask") args.push("--allow-all-tools");
      if (opts.permission === "yolo") args.push("--allow-all");
      return { args };
    }
    case "aider": {
      const args = ["--message", prompt, "--yes-always", "--no-auto-commits", "--no-pretty"];
      if (model) args.push("--model", model);
      return { args };
    }
    default:
      return { args: [] };
  }
}
