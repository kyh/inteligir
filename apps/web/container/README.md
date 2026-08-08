# @repo/agent-container

The agent image. One node process — the pi coding agent plus a daemon — running
inside a per-user Cloudflare Sandbox that the Worker's `UserHost` Durable Object
drives.

The split is the point: the object owns the vault, the transcript, the grant
table and every tool implementation; the container owns the model loop and a
scratch copy of the vault at `/workspace/vault`. It holds no credential, no tool
implementation and no policy.

- `src/protocol.ts` — the wire contract, imported by BOTH halves. The Worker
  reads it from `@repo/agent-container/protocol`. The report DEADLINES live here
  too, derived from the confirmation window rather than declared beside it: a
  container that gave up while a person was still answering would tell the model
  the result is unknown and have the action happen anyway.
- `src/main.ts` — the daemon: five HTTP paths, one turn at a time, and a
  dispatch that answers 202 rather than waiting for the agent.
- `src/requests.ts` — the runtime check for the three payloads the object drives
  it with, tied to the contract by assignment rather than by comment.
- `src/pi/` — the pi harness quarantine (see its README): the only files
  allowed to name `@earendil-works/pi-*`.
- `src/reporter.ts`, `src/vault-watcher.ts`, `src/tools.ts`,
  `src/browser-tool.ts` — the outbound half, the agent's file writes, the tool
  relays, and the one locally implemented tool.
- `src/vault-materialize.ts`, `src/vault-report.ts` — putting the object's bytes
  under `./vault` (refusing, never clamping, a path that would escape it), and
  READING THE ANSWER to what the agent wrote back. The answer is not a courtesy:
  the vault of record refuses removals outright and can refuse a write, while
  the agent's own file tools already told the model "done" against the copy — so
  the refusals are steered into the running turn.

## Tests

`pnpm --filter @repo/agent-container test` — a node suite, because this is a
node process. It covers the pieces where a silent wrong answer is possible: the
watcher's self-write attribution over a real directory and a real `fs.watch`
(the mechanism is the mtime a write actually produced, so a fake filesystem
proves nothing), the materializer's traversal guard, the reporter's one-attempt
rule and per-kind deadline, and the vault reply. pi is never started and no
provider is reached.

## Building

```bash
docker build -f apps/web/container/Dockerfile -t inteligir-agent .   # from the REPO ROOT
```

The context has to be the repo root: this is a pnpm workspace package, and its
versions come from the root lockfile and catalog. Everything a boot needs is
baked in — the container filesystem is deleted when it sleeps, and a wake
installs nothing.

Deploying it is owner-only, alongside the Worker (see `apps/web/README.md`).

## Runtime

- `node` on PATH, from the `cloudflare/sandbox` base image. The Worker starts
  the daemon with `startProcess("node /app/dist/main.js")` and waits for port
  8787; the image's own entrypoint stays the sandbox control server.
- `/workspace` (cwd, so `./vault` resolves) and `/agent` (pi's state). Both are
  created by the image and both are ephemeral.
- `INTELIGIR_REPORT_URL`, `INTELIGIR_REPORT_TOKEN` and `INTELIGIR_BOOT_ID` in
  the session environment. The boot payload carries the same report pair and is
  the authority for a boot generation — a daemon that survived a wake still has
  the previous boot's token in its environment.
- Outbound reach for the provider API and the Worker's own host, both allowed by
  `AgentSandbox.allowedHosts`. The `browser` tool is registered only when the
  boot carries Browser Run credentials (`CLOUDFLARE_ACCOUNT_ID` +
  `BROWSER_RUN_API_TOKEN` on the Worker); it additionally needs
  `api.cloudflare.com` in `AGENT_EXTRA_ALLOWED_HOSTS`, and whether a `wss://`
  CDP upgrade escapes a Sandbox at all is unverified — the tool says so in its
  own failure message rather than hanging.
- No credential. The provider key in the boot payload is a placeholder; the
  sandbox's outbound interception replaces the Authorization header on the way
  out, keyed on the `x-inteligir-sandbox` identity header this process sets. The
  report bearer it does hold entitles it to SPEND the user's provider quota and
  nothing else.
