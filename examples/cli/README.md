# CLI (curl)

Sends one prompt with curl. The hub speaks JSON on localhost; this is not a cloud API.

`curl.exe` ships with Windows 10+. In PowerShell type `curl.exe`, not `curl` (that alias is `Invoke-WebRequest`).

## Run

```bash
npm install
npm run dev
```

From the **repo root**, Git Bash / macOS / Linux:

```bash
chmod +x examples/cli/prompt.sh
./examples/cli/prompt.sh
```

Windows PowerShell:

```powershell
.\examples\cli\prompt.ps1
```

Env: `HUB`, `ADAPTER`, `WORKSPACE`, `TEXT`. First argument is the prompt if set.
