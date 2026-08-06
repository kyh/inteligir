# @repo/agent-container

The agent image. One node process — the pi coding agent plus a daemon — running
inside a per-user Cloudflare Sandbox that the Worker's `UserHost` Durable Object
drives.

The split is the point: the object owns the vault, the transcript, the grant
table and every tool implementation; the container owns the model loop and a
scratch copy of the vault at `/workspace/vault`. It holds no credential, no tool
implementation and no policy.

- `src/protocol.ts` — the wire contract, imported by BOTH halves. The Worker
  reads it from `@repo/agent-container/protocol`.
- `src/main.ts` — the daemon: five HTTP paths, one turn at a time, and a
  dispatch that answers 202 rather than waiting for the agent.
- `src/pi/` — the pi harness quarantine (see its README): the only files
  allowed to name `@earendil-works/pi-*`.
- `src/reporter.ts`, `src/vault-watcher.ts`, `src/tools.ts`,
  `src/browser-tool.ts` — the outbound half, the agent's file writes, the tool
  relays, and the one locally implemented tool.

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
  boot carries Browser Run credentials (`BROWSER_RUN_ACCOUNT_ID` +
  `BROWSER_RUN_API_TOKEN` on the Worker); it additionally needs
  `api.cloudflare.com` in `AGENT_EXTRA_ALLOWED_HOSTS`, and whether a `wss://`
  CDP upgrade escapes a Sandbox at all is unverified — the tool says so in its
  own failure message rather than hanging.
- No credential. The provider key in the boot payload is a placeholder; the
  sandbox's outbound interception replaces the Authorization header on the way
  out, keyed on the `x-inteligir-sandbox` identity header this process sets. The
  report bearer it does hold entitles it to SPEND the user's provider quota and
  nothing else.
