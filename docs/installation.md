# Installation

See also: [README — Installation](../README.md#installation) and [Quickstart](../README.md#quickstart).

## Dependencies

- **Node.js 22.18+** (required; `package.json` `engines.node` is `>=22.18`)
- **npm** (comes with Node)
- **Git** if you want the Changed panel to show a turn’s diff
- At least one **vendor CLI** on your `PATH`

This repo does not ship model weights or API keys.

## OS support

The hub is a Node process. It is used on **Windows**, and the same `npm run dev` path is intended for macOS and Linux.

Windows notes:

- `.cmd` / `.bat` CLIs are started with a shell; `.exe` is not.
- Sign-in opens a visible Command Prompt so browser login can finish.
- Install commands below that use `irm … | iex` are PowerShell.

## Install the hub

From a terminal in the project folder:

```bash
node -v
npm install
npm run check
npm run dev
```

You should see:

```text
Local AI  http://127.0.0.1:5173
```

Open that URL in a browser. The server binds **localhost only**.

If the port is busy:

```powershell
$env:PORT=5174; npm run dev
```

```bash
PORT=5174 npm run dev
```

There is no `npm start` / `npm run build` script. Day-to-day use is `npm run dev`.

## Install a model CLI

The UI will **open the official site** if you pick an agent that is not on `PATH`. You can also install ahead of time:

### Cursor Agent

Site: <https://cursor.com/download>

```powershell
irm https://cursor.com/install?win32=true | iex
```

Expect `agent` or `cursor-agent` on `PATH`. Then `agent login` (the UI can start this).

### Claude Code

Site: <https://code.claude.com/docs/en/overview>

```bash
npm i -g @anthropic-ai/claude-code
claude auth login
```

### GitHub Copilot CLI

Site: <https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli>

```bash
npm i -g @github/copilot
copilot login --web-flow
```

### Codex

Site: <https://developers.openai.com/codex/cli>

```bash
npm i -g @openai/codex
codex login
```

### Aider

Site: <https://aider.chat>

```bash
pip install aider-chat
```

Aider has no in-app login command; configure it the way Aider’s docs describe (API key or provider login in the environment).

## After install

1. In the UI, click the refresh control (↻) or **I’ve done this**.
2. Confirm the agent no longer says “not installed”.
3. If a **Sign in** banner appears, finish the vendor window, then refresh again.

Data the hub writes lives in `~/.local-ai` (`%USERPROFILE%\.local-ai` on Windows). That folder is created on first run.

Next: [Usage](usage.md) · [FAQ](faq.md)
