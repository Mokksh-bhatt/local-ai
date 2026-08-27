# FAQ

See also: [README](../README.md), [Installation](installation.md), [Usage](usage.md).

## The page is blank / “Connecting to local hub…”

The UI is served by the same process as `/hub`. Start it from the repo:

```bash
npm run dev
```

You should see `Local AI  http://127.0.0.1:5173`. Open that host, not a random Vite port. HMR is off on purpose so WebSocket upgrades to `/hub` work.

## `EADDRINUSE` / port 5173 already in use

Something (often an old hub) is bound to 5173.

```powershell
$env:PORT=5174; npm run dev
```

Or stop the other Node process using that port, then retry.

## Node version error / type stripping failed

You need **Node 22.18+**. `18` is not enough for `node --experimental-strip-types src/server/index.ts`.

```bash
node -v
```

## Agent says “not installed”

The binary is not on `PATH`. In the UI: **Open site** → install from the vendor → **I’ve done this**.

| Agent | Binary names |
| ----- | ------------ |
| Cursor | `agent`, `cursor-agent` |
| Claude | `claude` |
| Copilot | `copilot` |
| Codex | `codex` |
| Aider | `aider`, `aider-chat` |

On Windows, close and reopen the terminal (and restart `npm run dev`) after a global `npm i -g` so `PATH` updates.

## Sign-in banner / a Command Prompt popped up

That is expected when `loggedIn` is `false`. Finish the vendor login in that window (or the browser it opens), then click **I’ve done this**.

- Claude: `claude auth login`
- Copilot: `copilot login --web-flow`
- Cursor: `agent login`
- Codex: `codex login`
- Aider: no in-app login; set keys as Aider documents

If no window appears, click **Sign in** on the banner.

## Send stays on Stop / chat stays blank (Claude)

The hub must keep stdin open for permission prompts and must pass the user message as stream-json, not as a leftover argv prompt. Current `npm run dev` includes that. Restart the hub after pulling code. If it still hangs, check **Errors** — a missing login often shows there, not in the transcript.

## Copilot 400 / “model not supported”

Do not pass `auto` as the Copilot ACP model. Pick a listed model in the dropdown (for example `gpt-4.1`). Restart the hub if you were on an older build.

## Codex / Aider “does nothing”

Usually the CLI is not installed. The selector shows **not installed**; use **Open site**. Aider also needs whatever provider auth Aider itself expects.

## Changed shows random repo files / `AGENTS.md`

The hub should not seed `AGENTS.md`, `CLAUDE.md`, or `MEMORY.md` into your project. Memory lives in `~/.local-ai/MEMORY.md`. Changed is a **git diff for this turn**, not `git status` of the whole tree. Restart if you still see junk from an old process.

## Errors appeared inside the chat

They should land in the **Errors** tab. If you still see them in the thread, you are on a stale tab — hard-refresh after restarting `npm run dev`.

## Can my SaaS call this over the internet?

Not as designed. The server binds `127.0.0.1`. Users run the hub locally and use their own CLIs. Your product should detect “hub down” and send them to install/start Local AI — see [integration-examples.md](integration-examples.md).

## Where is chat saved?

`~/.local-ai/chats/<hash>.json`, one file per workspace path. Delete that file (or the folder) to reset a thread.

## `npm run check` fails

That script only tests parsers and argv helpers (`src/check.ts`). It does not need CLIs installed. If it fails after a pull, the stream parsers and the code disagree — fix the code, don’t skip the test.

## Is there a REST prompt API?

Yes. `POST /api/prompt` with JSON `{ adapterId, text, mode, permission, workspace }`. See [usage.md](usage.md) and [examples/cli](../examples/cli). Live streaming still uses WebSocket `/hub`.
