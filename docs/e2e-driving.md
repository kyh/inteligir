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
the seam, which is why the whole agent suite runs this way and why the suite is
evidence about the real thing.

It is what `pnpm --filter @repo/web test` already sets. For a running app, put it
in `apps/web/.dev.vars`:

```
AGENT_RUNTIME=scripted
```

A deployment without the Workers Paid plan or a built image gets it anyway —
there is nothing to fail closed, because a scripted container cannot reach a
provider at all.

## Getting a signed-in page

```bash
pnpm dev:web
```

Then sign in — `apps/web/README.md` § Dev has the four commands that materialize
the local D1 file, push the schema, mint an invite and create an account.
`agent-browser open http://localhost:5174/app` lands you on the workspace.

## Driving the Bridge directly

The page holds a live socket to its own `UserHost`, and the session token is
what authorizes it. From `agent-browser eval` on a signed-in `/app` page you can
open a SECOND socket and call any Bridge method — which is far faster than
clicking, and is how you set a fixture up before driving the UI over it.

```js
// In the page. `authClient` is not on window, so take the token from the API.
await (async () => {
  const session = await fetch("/api/auth/get-session").then((r) => r.json());
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/v1/host/${encodeURIComponent(session.user.id)}/ws`;
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const frame = JSON.parse(e.data);
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
  await new Promise((res) => {
    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", token: session.session.token }));
    ws.onmessage = (e) => {
      if (JSON.parse(e.data).t === "welcome") res();
    };
  });
  return await call("readVaultDoc", { path: "some-note.md" });
})();
```

(The `onmessage` above is replaced once the welcome lands — for a multi-call
script keep the `pending`-map handler installed from the start.)

## Flow 1 — a chat turn

`setFauxAgentScript` replaces the scripted container's response queue; one step
is consumed per assistant turn, and the queue is SHARED by chat and the
background lane — script, then drive exactly one flow before re-scripting. Empty
`steps` restores the self-refilling echo. It throws unless the runtime is
scripted, so it does nothing on a real deployment.

`getAgentSystemPrompt` is the assertion seam beside it: a payload-free call
returning the live chat agent's system prompt (`string`, or `null` before a turn
has composed one), so a prompt-shaping change can be asserted byte-for-byte
instead of inferred from model behavior.

1. Script the reply, over the Bridge:
   `call("setFauxAgentScript", { steps: [{ text: "SCRIPTED_CHAT_REPLY_42" }] })`
2. Type into the composer and submit (agent-browser): click "Ask the agent…",
   type into the "Ask the agent to edit your notes…" textbox, press Enter.
3. Assert the UI streamed it: poll until `document.body.textContent` contains
   `SCRIPTED_CHAT_REPLY_42`.

## Flow 2 — a delegation

The background lane runs the same scripted container, so a scripted tool call
performs the checkbox write-back. The delegation completes when the turn ends
AND the file is edited, so seed the note with known content first.

```js
const file = "scripted-delegation-test.md";
await call("writeVaultDoc", { path: file, content: "# T\n\n- [ ] scripted delegation task\n" });

// Step 1 carries the tool call; step 2 is the follow-up summary turn. The tool
// names and argument shapes are the manifest's own — `agentToolManifest` in
// apps/web/src/worker/agent/agent-tools.ts is the list.
await call("setFauxAgentScript", {
  steps: [
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
  ],
});

// ordinal = the checkbox's position among the doc's todo checkboxes (0 = first).
await call("createDelegation", { sourceFile: file, ordinal: 0 });
// then poll listDelegations() until delegations[0].status === "done",
// then readVaultDoc({ path: file }) to confirm "- [x] …".

// Clean up:
await call("setFauxAgentScript", { steps: [] }); // restore the echo
await call("deleteVaultEntry", { path: file });
```

## Teardown

Restore the echo (`setFauxAgentScript({ steps: [] })`) and delete anything the
run wrote. A scripted queue left primed makes the NEXT flow's first turn answer
with the previous flow's script, which reads as a bug in whatever you drive
next.
