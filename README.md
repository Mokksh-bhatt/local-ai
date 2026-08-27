# Local AI

A local hub that lets your apps talk to AI coding CLIs you already have — Cursor, Claude Code, GitHub Copilot, Codex, and Aider — so **you** pay the provider, not the app.

## Overview

Local AI is a small workbench that runs on your machine (`http://127.0.0.1:5173`). It does not call Anthropic, OpenAI, or GitHub APIs itself. It starts the official CLI for the agent you pick, using the login and keys already on your computer.

That is the point: **bring your own account (BYOK)**. Apps stay out of the token bill. Prompts and code stay on your machine. You keep the same subscriptions you use in the terminal.

More detail: [docs/overview.md](docs/overview.md).

## Features

- One UI for Cursor Agent, Claude Code, Copilot CLI, Codex, and Aider
- Uses each vendor’s CLI and **your** login — no shared API keys in this repo
- If a CLI is missing, the UI opens the **official install site**
- If you are signed out, the UI **asks you to sign in** (and opens the vendor login)
- Agent / plan / ask modes, plus ask / auto / yolo permissions
- Shared chat history and `MEMORY.md` under `~/.local-ai` (not dumped into your repo)
- Local HTTP (`GET /api/status`, `POST /api/prompt`) + WebSocket `/hub` so other tools on the same machine can plug in

## Installation

You need **Node.js 22.18 or newer** (this repo uses Node’s built-in TypeScript type-stripping). Git is useful for the Changed panel.

```bash
git clone <this-repo-url>
cd "Local AI API"
npm install
```

Install at least one model CLI from its vendor (this app will not download them for you):

| Agent   | Official site | Typical install |
| ------- | ------------- | --------------- |
| Cursor  | [cursor.com/download](https://cursor.com/download) | Windows: `irm https://cursor.com/install?win32=true \| iex` |
| Claude  | [code.claude.com](https://code.claude.com/docs/en/overview) | `npm i -g @anthropic-ai/claude-code` |
| Copilot | [Copilot CLI docs](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) | `npm i -g @github/copilot` |
| Codex   | [Codex CLI](https://developers.openai.com/codex/cli) | `npm i -g @openai/codex` |
| Aider   | [aider.chat](https://aider.chat) | `pip install aider-chat` |

Full OS notes: [docs/installation.md](docs/installation.md).

## Quickstart

From the repo folder:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

1. Pick a workspace folder (the project the agent may edit).
2. Pick an agent. If it is not installed, click **Open site**, install, then **I’ve done this**.
3. If you are signed out, finish the vendor sign-in window, then refresh.
4. Type a prompt and send.

Sanity check the parsers without starting the UI:

```bash
npm run check
```

Change the port if 5173 is taken:

```bash
# Windows PowerShell
$env:PORT=5174; npm run dev

# macOS / Linux
PORT=5174 npm run dev
```

## Testing

No extra test runner — Node 22’s built-in `node:test` plus a small parser script. Mocks spawn `node -e` instead of a real vendor CLI.

```bash
npm test
```

That runs:

- `src/bridge.test.ts` — mocked CLI success, nonzero exit, missing binary
- `src/check.ts` — stream parsers and spawn argv

CI runs the same `npm test` on GitHub Actions (Node 22 and 24) for every push and pull request. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Usage Examples

**SaaS app (no shared API bill).** Your product tells each user: “Install Local AI and your coding CLI.” The browser or desktop helper talks to `127.0.0.1` on *their* machine. You never hold their keys and you never pay per token.

**Internal tool.** A company wiki or ticket bot sends prompts to the hub WebSocket. Engineers use the Claude or Copilot account they already have. Cost stays on existing seats.

**CLI / script.** `GET /api/status` to see which CLIs are present, then `POST /api/prompt` or send JSON over `/hub`. Same hub, no extra daemon.

Copy-paste samples (hub already running):

- [examples/node-basic](examples/node-basic) — Node `fetch` one prompt
- [examples/web-backend](examples/web-backend) — tiny localhost sidecar (Express/Flask-shaped)
- [examples/cli](examples/cli) — curl / PowerShell

Protocol details: [docs/usage.md](docs/usage.md). App wiring: [docs/integration-examples.md](docs/integration-examples.md). How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration

Nothing in this repo is a cloud control plane. Useful knobs:

| What | Where |
| ---- | ----- |
| Hub URL | `http://127.0.0.1:5173` (or `PORT`) |
| Data dir | `~/.local-ai` (`%USERPROFILE%\.local-ai` on Windows) |
| Memory | `~/.local-ai/MEMORY.md` |
| Chat transcripts | `~/.local-ai/chats/` |
| Recent workspace | `~/.local-ai/state.json` |
| Skills | `~/.local-ai/skills/` |

The UI stores pane sizes in `localStorage` (`lai.left`, `lai.right`, `lai.composer`).

## Roadmap

- Keep adapters honest: only spawn official CLIs, never a second LLM wrapper
- Smoother first-run: install-from-site and sign-in prompts (in the UI now)
- No Gemini (removed on purpose)

Stuck? [docs/faq.md](docs/faq.md).

## License

[MIT](LICENSE). You can use, modify, and ship this inside proprietary SaaS products. Keep the copyright notice. MIT does not grant your users a license to Anthropic, GitHub, OpenAI, or other CLI vendors — they still need their own accounts.

Apache-2.0 was the other usual choice (extra patent grant, `NOTICE` file). MIT is enough for SaaS reuse and stays one file for a small repo.
