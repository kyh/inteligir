---
name: e2e-drive
description: Drive the Inteligir desktop app end-to-end with ZERO human login — a chat turn and a delegation via the scripted faux agent (INTELIGIR_FAUX_AGENT=1), and a Google connector connect via the local vercel-labs/emulate OAuth stub (INTELIGIR_EMULATE_CONNECTORS=1). Use when verifying agent/connector flows headlessly (so a change isn't left "unverified, owner-only"), or when asked to drive/verify chat, delegation, or a connector connect.
allowed-tools: Bash(*), Read, Edit, Write
---

# E2E drive (login-free)

Verify Inteligir's agent + connector flows headlessly. The full guide is
**`docs/e2e-driving.md`** — read it; this is the fast path.

Two dev-only, flag-gated stubs remove the OAuth wall (both fail closed — unset,
the app is byte-identical to production):

- `INTELIGIR_FAUX_AGENT=1` — pi-ai `faux` provider; script exact agent turns via
  the `setFauxAgentScript` Bridge channel. Powers **chat + delegation**.
- `INTELIGIR_EMULATE_CONNECTORS=1` — routes Google OAuth to
  `vercel-labs/emulate` (local, no login). Powers **connectors**.

## Setup

```bash
printf 'INTELIGIR_FAUX_AGENT=1\nINTELIGIR_EMULATE_CONNECTORS=1\n' > apps/desktop/.env
pnpm dev:desktop                       # real Electron (needed — NOT dev:harness), CDP :9222, daemon :47888
agent-browser connect 9222
npx -y emulate start --service google   # only for the connector flow → :4000
```

Kill stale instances first (they hold 9222/47888):
`pkill -f "turbo watch dev"; pkill -f "electron-vite"; pkill -f "Electron.app/Contents/MacOS/Electron"`.
If Electron dies with `Error: Electron uninstall`, run
`node apps/desktop/node_modules/electron/install.js` once.

## Drive it

Call ANY Bridge method from `agent-browser eval` via `window.bridgeBootstrap`
(`{ url, token }`): open the WS, send `{t:"auth",token}`, then `{t:"req",id,method,payload}`.
See `docs/e2e-driving.md` for the exact snippets.

- **Chat**: `setFauxAgentScript({steps:[{text:"MARKER"}]})` → type in the composer,
  press Enter → assert `MARKER` in the UI.
- **Delegation**: `writeVaultDoc` a note with a `[ ]` checkbox, then
  `setFauxAgentScript` with an `edit` tool-call step (`path:"vault/<file>"`, exact
  `oldText`/`newText`) followed by a final text step, then
  `createDelegation({sourceFile, ordinal:0})`, then poll `listDelegations` for
  `status:"done"`, then `readVaultDoc` to confirm the box is checked plus a result line.
- **Connector**: Settings → Connectors → a Google connector's **Connect** → read
  the pending `oauth_session` (`state` + `pkce_verifier`) from
  `~/.inteligir/executor/data/data.db` → POST emulate's
  `/o/oauth2/v2/auth/callback` with `code_challenge=S256(pkce_verifier)` → the
  daemon exchanges the code at emulate → `connection` row minted, card shows
  **Connected**. This proves register→consent→callback→token→connected. Live
  Google API tool-calls are OUT of scope (emulate serves no discovery docs) —
  see the fidelity boundary in the doc.

## Teardown (always)

```bash
pkill -f "turbo watch dev"; pkill -f "electron-vite"; pkill -f "Electron.app/Contents/MacOS/Electron"
pkill -f "emulate"
rm -f apps/desktop/.env
```

Also restore the faux echo (`setFauxAgentScript({steps:[]})`) and delete any
throwaway note (`deleteVaultEntry`) before killing the app.
