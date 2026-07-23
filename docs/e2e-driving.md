# Driving the app E2E, login-free

How a headless Claude session drives inteligir end-to-end with **zero human
OAuth** — a chat turn, a delegation, and a Google connector connect. This is the
durable capability from #461: verify agent/connector flows without ending every
change "unverified, owner-only." `docs/development.md` is the general dev loop;
this is the auth-free driving recipe.

Two dev-only, flag-gated stubs remove the login wall:

| Flow                 | Stub                                 | Flag                             |
| -------------------- | ------------------------------------ | -------------------------------- |
| Chat + delegation    | pi-ai `faux` provider (scripted)     | `INTELIGIR_FAUX_AGENT=1`         |
| Google connectors    | `vercel-labs/emulate` OAuth+API      | `INTELIGIR_EMULATE_CONNECTORS=1` |
| Fidelity runs (real) | real provider / real Google (cached) | neither flag                     |

Both flags fail closed: unset, the app is byte-identical to production (real
provider OAuth, real Google endpoints). The faux-scripting Bridge channel throws
unless `INTELIGIR_FAUX_AGENT=1`; the emulate override only swaps the Google
OAuth URLs and only when `INTELIGIR_EMULATE_CONNECTORS=1`. No security boundary
is weakened (no global cert-check disable — emulate is plain local HTTP).

## Run mode: real Electron, not the fixture harness

Everything here needs the **real host** (`pnpm dev:desktop`): the faux-scripting
channel, the executor daemon (connectors), and the delegation background agent
all live server-side. The browser fixture harness
(`pnpm --filter @repo/desktop dev:harness`) is UI-only — its `setFauxAgentScript`
/ `installConnector` stubs throw `unavailable`, by design.

Set the flags in `apps/desktop/.env` (the desktop main loads it in dev) — or
export them in the launching shell:

```bash
# apps/desktop/.env  (gitignored; remove when done)
INTELIGIR_FAUX_AGENT=1
INTELIGIR_EMULATE_CONNECTORS=1
```

Launch + attach:

```bash
pnpm dev:desktop                 # real Electron, CDP :9222, executor daemon :47888
agent-browser connect 9222       # attach to the renderer
```

**Kill stale instances between runs** — a leftover Electron/executor holds 9222
and 47888 and the next launch can't bind them:

```bash
pkill -f "turbo watch dev"; pkill -f "electron-vite"; pkill -f "Electron.app/Contents/MacOS/Electron"
```

After a `git worktree`/fresh checkout, Electron's binary may be unpacked but not
downloaded — if `pnpm dev:desktop` dies with `Error: Electron uninstall`, run
`node apps/desktop/node_modules/electron/install.js` once.

## Driving the Bridge without the UI

The renderer holds the WS endpoint + per-boot token at
`window.bridgeBootstrap` (`{ url, token }`). From an `agent-browser eval` you can
open that socket, send an `auth` frame, then `req` frames to call ANY Bridge
method directly — the reliable way to script the faux agent, seed a note, create
a delegation, and read a file back. The wire shape:

```js
// inside agent-browser eval — returns the method result
(async () => {
  const boot = window.bridgeBootstrap;
  const ws = new WebSocket(boot.url);
  const call = (method, payload) =>
    new Promise((res, rej) => {
      ws.send(JSON.stringify({ t: "req", id: 1, method, ...(payload ? { payload } : {}) }));
      ws.onmessage = (e) => {
        const f = JSON.parse(e.data);
        if (f.t === "res" && f.id === 1) f.ok ? res(f.result) : rej(new Error(f.error));
      };
    });
  await new Promise((res) => {
    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", token: boot.token }));
    ws.onmessage = (e) => {
      if (JSON.parse(e.data).t === "welcome") res();
    };
  });
  return await call("readVaultDoc", { path: "some-note.md" });
})();
```

(For multi-call scripts keep a `pending` map keyed by an incrementing `id` —
see the delegation recipe below.)

## Flow 1 — a chat turn (faux)

`setFauxAgentScript` replaces the faux provider's response queue; one step is
consumed per assistant turn (the queue is SHARED by chat and the delegation
background agent — script, then drive exactly one flow before re-scripting).
Empty `steps` restores the self-refilling echo.

`getAgentSystemPrompt` is the assertion seam beside it: a payload-free call —
`call("getAgentSystemPrompt")` — returning the live chat agent's system prompt
(`string`, or `null` when no agent is up), so a prompt-shaping change can be
asserted byte-for-byte instead of inferred from model behavior. Same fail-closed
gate as `setFauxAgentScript`: it throws unless `INTELIGIR_FAUX_AGENT=1`.

1. Script the reply, over the Bridge:
   `call("setFauxAgentScript", { steps: [{ text: "SCRIPTED_CHAT_REPLY_42" }] })`
2. Type into the composer and submit (agent-browser): click "Ask the agent…",
   type into the "Ask the agent to edit your notes…" textbox, press Enter.
3. Assert the UI streamed it: poll until `document.body.textContent` contains
   `SCRIPTED_CHAT_REPLY_42`.

Verified: the scripted text streams into the chat transcript with zero OAuth.

## Flow 2 — a delegation (faux)

The delegation background agent runs on the same faux provider, so a scripted
`edit` tool-call performs the checkbox write-back. The delegation completes when
the turn ends AND the file is edited; the `edit` tool's `oldText` must match the
note's bytes exactly, so seed the note with known content first.

Over the Bridge (one script, `pending`-map style), calling in order:

```js
const file = "faux-delegation-test.md";
await call("writeVaultDoc", { path: file, content: "# T\n\n- [ ] scripted delegation task\n" });

// pi's `edit` tool: { path, edits: [{ oldText, newText }] }. path is relative
// to the agent workspace, where ./vault symlinks the vault, so vault/<file>
// resolves. Step 1 carries the tool call (host maps it to stopReason "toolUse");
// step 2 is the follow-up summary turn.
await call("setFauxAgentScript", {
  steps: [
    {
      text: "Completing the task.",
      toolCalls: [
        {
          name: "edit",
          arguments: {
            path: "vault/" + file,
            edits: [
              {
                oldText: "- [ ] scripted delegation task",
                newText: "- [x] scripted delegation task\n  - done by the faux background agent",
              },
            ],
          },
        },
      ],
    },
    { text: "Checked the box and recorded the result." },
  ],
});

// ordinal = the checkbox's position among the doc's todo checkboxes (0 = first).
await call("createDelegation", { sourceFile: file, ordinal: 0 });
// then poll listDelegations() until delegations[0].status === "done",
// then readVaultDoc({ path: file }) to confirm "- [x] …" + the nested result line.

// Clean up:
await call("setFauxAgentScript", { steps: [] }); // restore the echo
await call("deleteVaultEntry", { path: file }); // to the OS trash
```

Verified: status flips to `done` with the tool-call summary; the file on disk
carries the byte-exact write-back — dispatch + write-back, login-free.

## Flow 3 — a Google connector connect (emulate)

`emulate` is a local Google OAuth+API stub. Start it (default base port **4000**;
`emulate start -p` moves it — then set `INTELIGIR_GOOGLE_OAUTH_AUTH_URL` /
`INTELIGIR_GOOGLE_OAUTH_TOKEN_URL` explicitly):

```bash
npx -y emulate start --service google      # → http://localhost:4000, user testuser@gmail.com (no password)
```

Under `INTELIGIR_EMULATE_CONNECTORS=1` the host registers the shared "google"
OAuth client at emulate's endpoints (`…:4000/o/oauth2/v2/auth` +
`…:4000/oauth2/token`) with placeholder credentials — emulate accepts any
client id/secret and any redirect URI, so no GCP app is needed.

**Start from a clean executor state** — an already-registered "google" client
always wins over the override. If a prior real Google client exists, either use
a fresh `~/.inteligir/executor/data` or disconnect it first.

The daemon opens the consent URL in the SYSTEM browser (`shell.openExternal`),
not the Electron renderer, so agent-browser can't see it. Complete consent
**headlessly** by POSTing emulate's callback directly (it renders a
one-click user-picker; the hidden form fields are all we need):

1. In the UI (agent-browser): Settings → Connectors → the Google connector's
   **Connect** (e.g. Gmail). The daemon registers the integration + a pending
   OAuth session.
2. Poll the in-flight consent over the Bridge (#462 — dev-only channel, throws
   without `INTELIGIR_EMULATE_CONNECTORS=1`):
   ```js
   await call("getPendingConnectorAuth"); // → { authorizationUrl, state } | null
   ```
   The `authorizationUrl` query string carries everything the consent form
   needs — `state`, `client_id`, `redirect_uri`, `scope`, `code_challenge`,
   `code_challenge_method` — already urlencoded. No PKCE hashing, no SQLite.
3. POST consent with that query string as the form body plus the picked user
   (curl `-L` follows the 302 into the daemon callback, which exchanges the
   code at emulate's token endpoint). Do NOT add `-X POST` — that pins the
   method across the redirect and the daemon callback 404s a POST; `--data`
   already makes the first request a POST, and `-L` correctly GETs the 302
   target:
   ```bash
   AUTH_URL='<authorizationUrl from getPendingConnectorAuth>'
   curl -sL "http://localhost:4000/o/oauth2/v2/auth/callback" \
     --data "email=testuser%40gmail.com&${AUTH_URL#*\?}" -o /dev/null
   ```
4. Confirm the connection minted (the daemon exchanged the code at emulate),
   over the Bridge:
   ```js
   await call("listExecutorConnections"); // → [{ owner:"user", name:"default", integration:"gmail", … }]
   ```
   The card flips to **Connected** in the UI, and `getPendingConnectorAuth`
   returns null again (the pending consent clears when the flow settles).
5. Clean up: click **Disconnect** on the card (the connection points at emulate
   and is useless in production).

That round-trip — register → consent → callback → token exchange → connected —
is the authenticated token-routing proof the issue accepts.

### Fidelity boundary (verified against emulate v0.9.0 + executor v1.5.4)

- **OAuth + token routing → emulate.** authorize, token, userinfo, and the empty
  JWKS all served locally. The whole connect round-trip is login-free.
- **id_token is NOT a blocker.** emulate signs the id_token HS256 with an empty
  JWKS (`/oauth2/v3/certs` → `{"keys":[]}`). Our executor daemon mints the
  connection from the **access_token** and does not RS256-verify the id_token
  against JWKS, so the connect succeeds regardless.
- **No API discovery docs, and no client-side workaround.** Both probed paths
  are dead ends (restructure step 2):
  - emulate has NO Google discovery route at all — `/discovery/v1/apis/
<api>/<ver>/rest` and `$discovery/rest` 404, and its route table contains
    no Google discovery endpoint (only Microsoft's `/discovery/v2.0/keys`
    JWKS). The integration is therefore registered from REAL Google's
    discovery doc (needs network) and its derived `rootUrl` is real
    `*.googleapis.com`.
  - the daemon's add-openapi `baseUrl` is accepted but **ignored for
    `googleDiscoveryBundle`** — the rootUrl comes from the discovery doc
    itself. Verified end-to-end against a scratch daemon: gmail registered
    with `baseUrl: http://localhost:4000` + an emulate-minted connection, and
    `gmail.users.messages.list` still dialed real `gmail.googleapis.com` →
    real-Google 401 (`Invalid Credentials`). Meanwhile emulate itself DOES
    serve partial Gmail/Calendar/Drive REST at `:4000` (a bearer request to
    `/gmail/v1/users/me/messages` returns 200) — but nothing can point the
    pinned third-party daemon there.
- **Conclusion:** the connector proof is scoped to **OAuth + token routing +
  Connected state**. A headless **authenticated tool-call** is out of reach
  until emulate serves discovery docs upstream (or we stand up a dev-only
  discovery-doc rewriting endpoint, deliberately NOT done — it would add a
  production-adjacent HTTP surface for a test convenience). For live Google
  API tool-calls, use a real cached Google connection (neither flag).

## Teardown (always)

Never leave a dev server, emulate, or the daemon running:

```bash
pkill -f "turbo watch dev"; pkill -f "electron-vite"; pkill -f "Electron.app/Contents/MacOS/Electron"
pkill -f "emulate"                          # or kill the npx emulate process
rm -f apps/desktop/.env                     # drop the dev flags
```
