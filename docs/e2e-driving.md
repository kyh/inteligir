# Driving the app E2E, login-free

How a headless session drives inteligir end-to-end without a provider account —
a chat turn and a delegation, both real code paths. The point is to verify agent
flows rather than ending every change "unverified, owner-only."
`docs/development.md` is the general dev loop; this is the driving recipe.

## The one stub: the agent's container

`AGENT_RUNTIME=scripted` swaps the per-user Cloudflare Sandbox for an in-memory
one (`apps/web/src/worker/agent/fake-sandbox.ts`). Everything around it is
production code: the runner, the tool manifest and executor, the transcript, the
confirmation broker, the snapshot store and the vault write-back. The port IS
the seam — in both directions, so the scripted container's reports are real
ones, presented with its own boot bearer and answered through the same entry an
HTTPS report reaches. That is why the whole agent suite runs this way and why
the suite is evidence about the real thing.

It is what `pnpm --filter @repo/web test` already sets. For a running app, put it
in `apps/web/.dev.vars`:

```
AGENT_RUNTIME=scripted
```

It is opt-in, not a fallback. `sandboxRuntimeEnabled` keys entirely off this one
variable, so a deployment with no Workers Paid plan and no image still gets the
real port unless it sets this, and fails at container boot.

## Getting a signed-in page

```bash
pnpm dev:web
```

Then sign in — `AGENTS.md` § "There is no seeded login" has the commands that
materialize the local D1 file, push the schema and mint an invite; the account
itself is made in the browser at `/app/sign-up`, which the sign-in page links
to. `agent-browser open http://localhost:5174/app` then lands you on the
workspace.

## Driving the Bridge directly

The page holds a live socket to its own `UserHost`. From `agent-browser eval`
on a signed-in `/app` page you can open a SECOND socket and call any Bridge
method — far faster than clicking, and how you set a fixture up before driving
the UI over it.

The credential is a single-use TICKET, minted same-origin against the session
cookie. There is no userId in the URL and no session token in the page: the
object is derived from the cookie the mint carries, and the socket spends the
ticket in its first frame. Pipe the script in with `agent-browser eval --stdin`
— a top-level `await` is not available, so wrap it in an async IIFE.

`call` is scoped to that IIFE and does NOT survive to the next `agent-browser
eval`. The snippet's last line parks it on `window`, so the flows below can run
as their own evals against the same socket until the page reloads; drop that
line and each eval has to re-mint and re-dial inside its own IIFE.

```js
(async () => {
  const minted = await fetch("/v1/host/ticket", { method: "POST" }).then((r) => r.json());
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${scheme}//${location.host}/v1/host/ws`);
  let id = 0;
  const pending = new Map();
  let welcome;
  const welcomed = new Promise((resolve) => {
    welcome = resolve;
  });
  // Installed from the start and never replaced, so an event arriving between
  // the welcome and the first call cannot land on a handler that isn't there.
  ws.onmessage = (event) => {
    const frame = JSON.parse(event.data);
    if (frame.t === "welcome") welcome();
    if (frame.t === "res") pending.get(frame.id)?.(frame);
  };
  const call = (method, payload) =>
    new Promise((resolve, reject) => {
      const at = ++id;
      pending.set(at, (frame) =>
        frame.ok ? resolve(frame.result) : reject(new Error(frame.error)),
      );
      ws.send(JSON.stringify({ t: "req", id: at, method, payload }));
    });
  ws.onopen = () => ws.send(JSON.stringify({ t: "auth", ticket: minted.ticket }));
  await welcomed;
  // Parked so the flows below can be their own evals against this same socket.
  window.call = call;
  // Scripting is a LEAF, not a channel: a capability only the scripted runtime
  // has does not belong in the contract every client bundles. Same session the
  // socket authenticated with, so it needs no credential of its own.
  window.script = (steps) =>
    fetch("/v1/host/scripted?verb=script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps }),
    }).then((r) => {
      if (!r.ok) throw new Error(`script failed: ${r.status}`);
    });
  return await call("readVaultFile", { path: "Welcome.md" });
})();
```

## Flow 1 — a chat turn

`POST /v1/host/scripted?verb=script` replaces the container's response queue; one step
is consumed per assistant turn, and BOTH lanes are seeded with the same steps —
two independent queues, each drained on its own, so a stray chat turn does not
eat the background lane's step. Script, then drive exactly one flow before
re-scripting. Empty `steps` restores the self-refilling echo. It throws unless
the runtime is scripted, so it does nothing on a real deployment.

A step carries three things, and the difference between the last two is the
whole shape of the agent: `text` is what the model said, `toolCalls` are the
GRANTED tools (implemented host-side, so they run the real executor and the real
confirmations), and `writes` are what the agent's OWN file tools did to
`./vault` — which reach the vault of record as a reported write, get a restore
point captured for them, and can be refused.

**The queue does not survive hibernation.** It lives in an in-memory field on
the Durable Object, and an idle object with open sockets is evicted — a minute
of clicking around between scripting and sending is enough to lose it. Script
IMMEDIATELY before the turn, and read an echoed reply (`[scripted] <your
message>`) as "the script was dropped, re-script and retry", never as a bug in
whatever you just changed.

`POST /v1/host/scripted?verb=system-prompt` is the assertion seam beside it:
a call that
composes and returns the chat agent's system prompt from the current vault
(always a `string`, on any runtime, before any turn has run), so a
prompt-shaping change can be asserted byte-for-byte instead of inferred from
model behavior.

1. Script the reply, over the Bridge:
   `script([{ text: "SCRIPTED_CHAT_REPLY_42" }])`
2. Type into the composer and submit (agent-browser): click "Ask the agent…",
   type into the "Ask the agent to edit your notes…" textbox, press Enter.
3. Assert the UI streamed it: poll until `document.body.textContent` contains
   `SCRIPTED_CHAT_REPLY_42`.

## Flow 2 — a delegation

The background lane runs the same scripted container, so a scripted tool call
performs the checkbox write-back. The delegation completes when the turn ends
AND the file is edited, so seed the note with known content first.

The body below still needs its own `async () => { … }` wrapper per eval (top-
level `await` is unavailable); `call` and `script` are the two the snippet parked on `window`.

```js
const file = "scripted-delegation-test.md";
await call("writeVaultFile", { path: file, content: "# T\n\n- [ ] scripted delegation task\n" });

// Step 1 carries the tool call; step 2 is the follow-up summary turn. The tool
// names and argument shapes are the manifest's own — `agentToolManifest` in
// apps/web/src/worker/agent/agent-tools.ts is the list.
await script([
  {
    text: "Completing the task.",
    toolCalls: [
      {
        name: "toggle_task",
        arguments: { path: file, ordinal: 0, expectedRaw: "- [ ] scripted delegation task" },
      },
    ],
  },
  { text: "Checked the box and recorded the result." },
]);

// ordinal = the checkbox's position among the doc's todo checkboxes (0 = first).
await call("createDelegation", { sourceFile: file, ordinal: 0 });
// then poll listDelegations() until delegations[0].status === "done",
// then readVaultFile({ path: file }) to confirm "- [x] …".

// Clean up:
await script([]); // restore the echo
await call("deleteVaultEntry", { path: file });
```

## Teardown

Restore the echo (`script([])`) and delete anything the
run wrote. A scripted queue left primed makes the NEXT flow's first turn answer
with the previous flow's script, which reads as a bug in whatever you drive
next.
