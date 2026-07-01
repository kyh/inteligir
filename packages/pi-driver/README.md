# `@repo/pi-driver` — pi-coding-agent wrapper

A thin, stable surface over [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
and `@mariozechner/pi-ai`. App code (mainly `packages/host`) talks to this package
instead of pi's internals, so when pi moves an export or changes a signature, the
blast radius is one file here — not the whole desktop app.

## Modules

```
src/
  agent.ts      The Agent class — wraps createAgentSession; lifecycle, events,
                tool/message plumbing. PiAgentConfig is the injection surface
                (cwd, agentDir, authStorage, model, sessionManager, extensions).
  auth.ts       createAuthStorage(authPath) — pi's OAuth credential store
  model.ts      resolveModel(provider, modelId) from pi-ai's static registry
  skills.ts     loadSkills + PiAgentSkill projection (serializable over IPC)
  complete.ts   One-shot complete() helper, with a cached ModelRegistry per AuthStorage
  pi-types.ts   Curated re-exports of pi types the desktop reaches for
```

No barrel — import by file:

```ts
import { Agent } from "@repo/pi-driver/agent";
import { createAuthStorage } from "@repo/pi-driver/auth";
import { resolveModel } from "@repo/pi-driver/model";
```

## Design rule

Everything that crosses the IPC boundary is projected to a **plain, serializable**
shape here (`PiAgentTool`, `PiAgentSkill`, …) rather than leaking pi's classes.
`pi-types.ts` is the single chokepoint for type re-exports: if pi swaps an export
location, only that file changes.

This package has no Electron dependency — it's the pi adapter, not the app. The
glue that wires it into the desktop (ports, lifecycle, IPC) lives in
`packages/host/src/`.

## Typecheck

```bash
pnpm --filter @repo/pi-driver typecheck
```
