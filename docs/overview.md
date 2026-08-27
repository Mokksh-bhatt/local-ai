# Overview

See also: [README](../README.md#overview).

## What this is

Local AI is a **bridge on your computer** between a simple web UI (or any local client) and the AI CLIs you already installed.

It does **not**:

- Call provider HTTP APIs with a key from this repo
- Meter or resell tokens
- Upload your repo to a third-party “Local AI” cloud

It **does**:

- Detect CLIs on your `PATH` (Cursor `agent`, `claude`, `copilot`, `codex`, `aider`)
- Ask you to **install from the vendor site** if a CLI is missing
- Ask you to **sign in** with that vendor if you are logged out
- Spawn that CLI against a workspace folder you choose
- Stream replies, tool calls, and permission prompts into the UI

## Why that matters

| Problem | How the hub helps |
| ------- | ----------------- |
| Shared API keys in a SaaS backend | Users bring their own accounts. Your app is not the bill payer. |
| Keys sitting in `.env` files | Login lives in the official CLI (`claude auth login`, `copilot login`, …). |
| Privacy | Traffic stays process-to-process on localhost plus whatever that CLI already does. |
| Control | You pick the agent, model, mode, and whether file edits need approval. |

## High-level flow

```
You  →  browser at 127.0.0.1:5173
              │
              │  WebSocket /hub  (JSON)
              ▼
         Local AI hub  (Node)
              │
              │  spawn official CLI
              ▼
     Cursor / Claude / Copilot / Codex / Aider
              │
              ▼
         Your workspace folder
```

1. `npm run dev` starts an HTTP server and a WebSocket at `/hub`.
2. The UI (or another client) sends `{ "type": "hello" }`, then `{ "type": "prompt", ... }`.
3. The hub builds a prompt from `~/.local-ai/MEMORY.md`, optional skills, recent chat, and your message.
4. ACP agents (Cursor, Copilot) speak JSON-RPC on stdin/stdout. Headless agents (Claude, Codex, Aider) use each CLI’s print/exec flags.
5. Stream events (`text_delta`, `thought`, `permission`, `done`, …) go back over the socket.

Chat history is stored per workspace under `~/.local-ai/chats/`. Switching agents in the same workspace reuses that transcript so you are not starting from a blank thread.

Next: [Installation](installation.md) · [Usage](usage.md)
