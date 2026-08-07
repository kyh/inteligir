---
name: e2e-drive
description: Drive Inteligir end-to-end without a provider account — a chat turn and a delegation through the scripted agent container (AGENT_RUNTIME=scripted), called straight over the Bridge from a signed-in /app page. Use when verifying agent flows headlessly (so a change isn't left "unverified, owner-only"), or when asked to drive/verify chat or delegation.
allowed-tools: Bash(*), Read, Edit, Write
---

# E2E drive (no provider account)

Verify the agent flows headlessly. The full guide is **`docs/e2e-driving.md`** —
read it; this is the fast path.

One stub, and it is a narrow one: `AGENT_RUNTIME=scripted` swaps the per-user
Cloudflare Sandbox for an in-memory container. The runner, the tool manifest and
executor, the transcript, the confirmation broker, the snapshots and the vault
write-back are all production code — the port IS the seam, which is why the
whole agent suite runs this way.

## Setup

```bash
# apps/web/.dev.vars (gitignored) — append, don't overwrite.
printf 'AGENT_RUNTIME=scripted\n' >> apps/web/.dev.vars
pnpm dev:web
agent-browser open http://localhost:5174/app
```

Sign-up is invite-only and there is no seeded account — `apps/web/README.md`
§ Dev has the commands to materialize the local D1 file, push the schema, mint
an invite and create one. Do that once; the browser keeps the session.

## Drive it

Call ANY Bridge method from `agent-browser eval` on the signed-in page: read the
session from `/api/auth/get-session`, open
`wss://<host>/v1/host/<userId>/ws`, send `{t:"auth",token}`, then
`{t:"req",id,method,payload}`. The exact snippet is in `docs/e2e-driving.md`.

- **Chat**: `setFauxAgentScript({steps:[{text:"MARKER"}]})` → type in the
  composer, press Enter → assert `MARKER` in the UI.
- **Delegation**: `writeVaultDoc` a note with a `[ ]` checkbox, then
  `setFauxAgentScript` with a `toggle_task` tool-call step followed by a final
  text step, then `createDelegation({sourceFile, ordinal:0})`, then poll
  `listDelegations` for `status:"done"`, then `readVaultDoc` to confirm the box
  is checked.

The scripted queue is SHARED by chat and the background lane — one step per
assistant turn — so script, then drive exactly one flow before re-scripting.
`agentToolManifest` in `apps/web/src/worker/agent/agent-tools.ts` is the list of
tool names and argument shapes a step may call.

## Teardown (always)

Restore the echo and clean up what you wrote, before killing the dev server:

```js
await call("setFauxAgentScript", { steps: [] });
await call("deleteVaultEntry", { path: "<the throwaway note>" });
```

A queue left primed makes the NEXT flow's first turn answer with the previous
flow's script, which reads as a bug in whatever you drive next.
