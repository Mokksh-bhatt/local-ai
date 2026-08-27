import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AdapterId, ChatTurn, Skill } from "../shared.ts";

const exec = promisify(execFile);
export const dataDir = path.join(os.homedir(), ".local-ai");

export type AppState = {
  recent: string[];
  skills: Record<string, boolean>;
  adapterId?: AdapterId;
  workspace?: string;
  models?: Partial<Record<AdapterId, string>>;
};

export function ensureDataDir() {
  fs.mkdirSync(path.join(dataDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "chats"), { recursive: true });
  const mem = path.join(dataDir, "MEMORY.md");
  if (!fs.existsSync(mem)) fs.writeFileSync(mem, "");
  const statePath = path.join(dataDir, "state.json");
  if (!fs.existsSync(statePath)) fs.writeFileSync(statePath, '{"recent":[],"skills":{}}');
}

export function readState(): AppState {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8")) as AppState;
  } catch {
    return { recent: [], skills: {} };
  }
}

export function writeState(s: AppState) {
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(s, null, 2));
}

export function rememberWorkspace(cwd: string) {
  cwd = path.resolve(cwd);
  const s = readState();
  const recent = s.recent
    .map((p) => {
      try {
        return path.resolve(p);
      } catch {
        return p;
      }
    })
    .filter((p) => p !== cwd);
  s.workspace = cwd;
  s.recent = [cwd, ...recent].slice(0, 8);
  writeState(s);
}

export function readMemory(cwd: string) {
  const glob = path.join(dataDir, "MEMORY.md");
  const globalText = fs.existsSync(glob) ? fs.readFileSync(glob, "utf8") : "";
  if (!cwd) return globalText;
  const local = path.join(cwd, "MEMORY.md");
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  return globalText;
}

export function saveMemory(cwd: string, text: string) {
  fs.writeFileSync(path.join(dataDir, "MEMORY.md"), text);
  const local = path.join(cwd, "MEMORY.md");
  if (cwd && fs.existsSync(local)) fs.writeFileSync(local, text); // ponytail: never create MEMORY.md in the repo
}

function chatFile(cwd: string) {
  const id = crypto.createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 16);
  return path.join(dataDir, "chats", `${id}.json`);
}

export function loadChat(cwd: string): ChatTurn[] {
  if (!cwd) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(chatFile(cwd), "utf8")) as ChatTurn[];
    return Array.isArray(raw) ? raw.filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") : [];
  } catch {
    return [];
  }
}

export function saveChat(cwd: string, chat: ChatTurn[]) {
  if (!cwd) return;
  fs.writeFileSync(chatFile(cwd), JSON.stringify(chat.slice(-80), null, 2));
}

export function buildPrompt(opts: { memory: string; skills: Skill[]; history: ChatTurn[]; user: string }): string {
  const bits: string[] = [];
  const mem = opts.memory.trim();
  if (mem) bits.push("Durable memory (shared by every agent in this workspace):\n" + mem.slice(0, 8000));
  const enabled = opts.skills.filter((s) => s.enabled);
  if (enabled.length) {
    bits.push("Skills (read the SKILL.md only when needed): " + enabled.map((s) => `${s.name} — ${s.path}`).join("; "));
  }
  const hist = opts.history.filter((t) => t.text.trim()).slice(-20);
  if (hist.length) {
    bits.push(
      "Unified conversation so far. Continue it; do not restart:\n" +
        hist.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.trim().slice(0, 4000)}`).join("\n\n"),
    );
  }
  bits.push(opts.user);
  return bits.join("\n\n");
}

export type GitSnap = { status: string; patch: string };

export async function gitDiff(cwd: string): Promise<GitSnap> {
  try {
    const { stdout: status } = await exec("git", ["-C", cwd, "status", "--porcelain"], { windowsHide: true });
    const { stdout: patch } = await exec("git", ["-C", cwd, "diff", "--no-color"], {
      windowsHide: true,
      maxBuffer: 2_000_000,
    });
    return { status, patch };
  } catch {
    return { status: "", patch: "" };
  }
}

export async function gitTurnDiff(cwd: string, before: GitSnap): Promise<GitSnap> {
  const after = await gitDiff(cwd);
  const files = (status: string) =>
    status
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .map((raw) => ({ raw, path: raw.slice(3).trim() }));
  const prev = new Map(files(before.status).map((f) => [f.path, f.raw]));
  const changed = files(after.status).filter((f) => prev.get(f.path) !== f.raw);
  if (!changed.length) return { status: "", patch: "" };
  const tracked = changed.filter((f) => !f.raw.startsWith("??")).map((f) => f.path);
  let patch = "";
  if (tracked.length) {
    try {
      const { stdout } = await exec("git", ["-C", cwd, "diff", "--no-color", "--", ...tracked], {
        windowsHide: true,
        maxBuffer: 2_000_000,
      });
      patch = stdout;
    } catch {
      patch = "";
    }
  }
  return { status: changed.map((f) => f.raw).join("\n"), patch };
}

export function listSkills(cwd: string): Skill[] {
  const roots = [path.join(dataDir, "skills"), path.join(cwd, ".agents", "skills")];
  const state = readState();
  const out: Skill[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const skillMd = path.join(root, name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const body = fs.readFileSync(skillMd, "utf8");
      const title = body.match(/^name:\s*(.+)$/m)?.[1]?.trim() || name;
      const description =
        body.match(/^description:\s*>?\s*(.+)$/m)?.[1]?.trim() ||
        body.replace(/^---[\s\S]*?---/, "").trim().slice(0, 140);
      out.push({
        id: name,
        name: title,
        description,
        path: skillMd,
        enabled: state.skills[name] !== false,
      });
    }
  }
  return out;
}

export function toggleSkill(id: string, enabled: boolean) {
  const s = readState();
  s.skills[id] = enabled;
  writeState(s);
}

export function listDirs(p: string): { path: string; dirs: string[]; parent: string | null } {
  const resolved = path.resolve(p || os.homedir());
  const parent = path.dirname(resolved) === resolved ? null : path.dirname(resolved);
  try {
    const dirs = fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "node_modules" && d.name !== ".git")
      .map((d) => path.join(resolved, d.name))
      .slice(0, 80);
    return { path: resolved, dirs, parent };
  } catch {
    return { path: resolved, dirs: [], parent };
  }
}

export function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
