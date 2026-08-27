# Node: one prompt

Talks to the local hub with `fetch`. No extra npm packages.

The hub must be running (`npm run dev` in the repo root) and at least one CLI must be installed and signed in.

## Run

```bash
npm install
npm run dev
```

In another terminal, from the **repo root**:

```bash
node examples/node-basic/prompt.mjs
```

Optional env: `HUB` (default `http://127.0.0.1:5173`), `ADAPTER` (default: first CLI on PATH), `WORKSPACE` (default: current directory), `TEXT`.
