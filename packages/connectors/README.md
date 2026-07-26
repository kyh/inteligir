# @repo/connectors

The MCP/connectors capability behind code mode: executor daemon lifecycle, a
typed client over its HTTP API, connector install/uninstall orchestration, the
bundled Google OAuth client, and the dev-only emulate-connectors override.

## Why it exists

Node-only, sits BELOW `@repo/server` in the dep DAG (deps: bridge, installer,
storage). Never imports server or electron — upward needs are injected
(`ConnectorInstallOps` binds `openExternal` per call). `@repo/agent` never
imports this package: code mode reaches the daemon through the injected
`ExecutorPort` (`packages/server/src/boot/agent-wiring.ts` binds
`executeEnsuringDaemon`/`resumeEnsuringDaemon`), so the agent↔daemon edge is a
composition-root fact, not an import.

## Layout

```
src/
  executor-daemon.ts       # Daemon manager: checksum-pinned GitHub-release install
                           # (via @repo/installer), spawn/ready-banner/stop lifecycle
                           # under ~/.inteligir/executor, wedged-orphan reaping
  executor-client.ts       # Typed fetch client over the daemon's /api/* routes
                           # (TypeBox-validated at the boundary), incl. the
                           # *EnsuringDaemon execute/resume variants that restart
                           # a crashed daemon before each call
  connector-install.ts     # install/uninstall orchestration (ports-injected):
                           # register integration → mint connection → browser OAuth
                           # → rollback on failure; re-entrancy guard per slug
  google-oauth-client.ts   # Bundled Google "Desktop app" client: shell/env
                           # credential resolution + ensureGoogleOAuthClient
  emulate-connectors.ts    # Dev-only Google-OAuth endpoint override
                           # (INTELIGIR_EMULATE_CONNECTORS=1 → vercel-labs/emulate
                           # on localhost:4000), gated on @repo/bridge/dev-flags
```

## Invariants

- **Install fails closed.** Every release artifact's SHA-256 is pinned in
  `executor-daemon.ts`; a tampered release, or one upstream re-uploaded in
  place under the same tag, refuses to install rather than running unverified
  code. A sudden wave of install failures is that guard working — audit and
  re-pin, never skip verification.
- **Pinned port 47888.** The OAuth redirect URI users whitelist in Google Cloud
  must survive restarts. If taken, the daemon falls back to an auto-picked port
  — everything works except externally whitelisted redirect URIs.
- **Reaping is triple-guarded.** A wedged orphan is only SIGKILLed when our
  manifest records it, the pid is verifiably our executor binary (defeats pid
  recycling), AND it fails a health probe. Anything inconclusive → no kill.
- **Emulate is dev-only, fail-closed.** Every env read (the flag AND the
  explicit URL overrides) is gated on the boot-computed dev-flag bit
  (`@repo/bridge/dev-flags`); a packaged build always resolves real Google.
- **The bundled Google client never overwrites a registered one.** An existing
  "google" OAuth client (the user's own GCP app) always wins in
  `ensureGoogleOAuthClient`. Its client secret is a Google installed-app
  credential — not confidential by RFC 8252 §8.5; shipping it is Google's model.
- **Failed installs leave nothing behind.** Rollback removes only the
  integration this call created; registered OAuth clients are kept (removing
  the user's Google app would be destructive).
- **Daemon state lives in `~/.inteligir/executor`** (bin/data/scope): catalog +
  OAuth tokens persist across restarts; covered by the owner-only
  `~/.inteligir` decision (0700/0600, `hardenAppDir`).

## Seams

- `ConnectorInstallOps` / `GoogleOAuthClientOps` — bound in
  `packages/server/src/handlers/executor-handlers.ts`: the real
  executor-client methods 1:1, plus the platform's `openExternalHttpUrl` and a
  real `waitMs`. Tests pass fakes.
- `ExecutorPort` (defined in `@repo/agent/extension`) — bound in
  `packages/server/src/boot/agent-wiring.ts` to the `*EnsuringDaemon` client
  variants; the same file eager-starts the daemon at boot.
- `HostOptions.bundledGoogleClient` — the desktop shell bakes credentials via
  electron-vite `define` and passes them through; `INTELIGIR_GOOGLE_OAUTH_CLIENT_*`
  env vars are the runtime fallback (`getBundledGoogleClient`).

## Testing

```bash
pnpm --filter @repo/connectors test
```

`executor-daemon.test.ts` pins ready-banner parsing (complete lines only),
failure-tail reporting, the three reap guards, and shared/queued install
sequencing; `executor-restart.test.ts` pins the restart-after-crash execute/
resume path; `connector-install.test.ts` pins step order, rollback, Google
migration-orphan recovery, and re-entrancy; `emulate-connectors.test.ts` +
`dev-flags.test.ts` pin env precedence and the packaged-build refusal;
`google-oauth-client.test.ts` pins env fallback and never-overwrite.
