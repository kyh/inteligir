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
# .dev.vars is gitignored, so a fresh checkout has none. The example already
# ships AGENT_RUNTIME=scripted (plus the two vars without which nothing works:
# BETTER_AUTH_SECRET and HOST_ALLOWED_ORIGINS).
cp apps/web/.dev.vars.example apps/web/.dev.vars    # then set BETTER_AUTH_SECRET
pnpm dev:web                                        # needs a running Docker daemon
agent-browser open http://localhost:5174/app
```

Sign-up is invite-only and there is no seeded account — `AGENTS.md` § "There is
no seeded login" has the commands to materialize the local D1 file, push the
schema and mint an invite; the account itself is made in the browser at
`/app/sign-up`. Do that once; the browser keeps the session.

## Drive it

Scripting is NOT a Bridge channel — a capability only the scripted runtime has
has no place in the contract every client bundles. It is a leaf on the same
session the socket uses, so one fetch from the signed-in page does it:

```js
const script = (steps) =>
  fetch("/v1/host/scripted?verb=script", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ steps }),
  }).then((r) => {
    if (!r.ok) throw new Error(`script failed: ${r.status}`);
  });
```

`fetch("/v1/host/scripted?verb=system-prompt", { method: "POST" }).then(r => r.json())` returns
`{ prompt }` — the chat agent's composed system prompt, for byte-exact
assertions. Both answer 404 off `AGENT_RUNTIME=scripted`.

Call ANY Bridge method from `agent-browser eval` on the signed-in page.
**Use the snippet in `docs/e2e-driving.md` verbatim** — the credential is a
single-use ticket minted at `POST /v1/host/ticket` against the session cookie,
spent as `{t:"auth", ticket}` in the socket's first frame on
`wss://<host>/v1/host/ws`. There is no userId in the URL, no session token in
the page, and `/api/auth/get-session` yields nothing the socket accepts.

- **Chat**: `script([{text:"MARKER"}])` → type in the
  composer, press Enter → assert `MARKER` in the UI.
- **Delegation**: `writeVaultFile` a note with a `[ ]` checkbox, then
  `script(…)` with a `toggle_task` tool-call step followed by a final
  text step, then `createDelegation({sourceFile, ordinal:0})`, then poll
  `listDelegations` for `status:"done"`, then `readVaultFile` to confirm the box
  is checked.

- **An agent file write**: a step's `writes: [{path, text}]` is what the agent's
  own file tools did to `./vault`. It reaches the vault of record as a reported
  write — restore point captured, removals refused — rather than as a tool call.

Both lanes are seeded with the same steps — two independent queues, one step per
assistant turn — so script, then drive exactly one flow before re-scripting.
`agentToolManifest` in `apps/web/src/worker/agent/agent-tools.ts` is the list of
tool names and argument shapes a step may call.

**The queue dies with hibernation.** It is an in-memory field on the Durable
Object, and an idle object with open sockets is evicted — a minute of clicking
between scripting and sending loses it. Script IMMEDIATELY before the turn, and
read an echoed reply (`[scripted] <your message>`) as "re-script and retry",
never as a bug in what you changed.

## Teardown (always)

Restore the echo and clean up what you wrote, before killing the dev server:

```js
await script([]);
await call("deleteVaultEntry", { path: "<the throwaway note>" });
```

A queue left primed makes the NEXT flow's first turn answer with the previous
flow's script, which reads as a bug in whatever you drive next.
