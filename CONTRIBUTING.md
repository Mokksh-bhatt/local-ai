# Contributing

This is a small, mostly solo project. Issues and PRs are welcome if they stay in scope: **a local hub that spawns official AI CLIs**. It should not grow a second LLM client or a cloud API bill.

## Issues

Open a GitHub issue for bugs or questions.

For bugs, include:

- OS and `node -v` (need 22.18+)
- Which agent (`cursor` / `claude` / `copilot` / `codex` / `aider`)
- Whether the CLI is on `PATH` and whether you are signed in
- What you did, what you expected, what happened
- Anything in the UI **Errors** tab or the `npm run dev` terminal

Search existing issues first. One problem per issue.

## Features

Open an issue **before** a large PR. Say what user pain it fixes.

Likely yes: clearer errors, another official CLI adapter, docs, example fixes.

Likely no: wrapping provider HTTP APIs, extra LLM layers, remote multi-tenant hosting, Gemini (removed on purpose).

## Branches and PRs

1. Fork (or branch from `master`).
2. Name branches like `fix/copilot-login` or `docs/faq`.
3. Keep the diff small. Match existing style (few files, Node stdlib first).
4. Do not commit secrets, `.env`, or `~/.local-ai`.
5. Open a PR against `master` with:
   - Why (not a file list)
   - How you tested (`npm run check`, UI path, or an example)

The maintainer may squash-merge, ask for cuts, or close extras that belong in an issue first.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173. `npm test` is the automated suite (mocked CLI bridge + parsers). GitHub Actions runs it on push and PR.

Runnable samples (hub must already be up):

- [examples/node-basic](examples/node-basic)
- [examples/web-backend](examples/web-backend)
- [examples/cli](examples/cli)

Docs live in [README.md](README.md) and [docs/](docs/).

## Conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
