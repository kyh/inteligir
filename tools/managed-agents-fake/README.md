# @repo/managed-agents-fake

A Managed Agents API with no model and no account behind it. The local Worker
(`pnpm dev:web`), the e2e scenarios and the Worker's suites run the built-in
agent against it, through the SDK's `baseURL` or as its `fetch`, so the cell
runs the one code path it runs deployed
(`apps/web/src/worker/agent/managed-agents.ts`).

It keeps vaults, credentials, sessions and their events in memory, answers each
call in the shapes the API reference records, streams events as SSE with
previews of the agent's message, pauses a session at its budget, waits on an
`always_ask` call's confirmation, and ends a running turn at an interrupt. Its
agent calls the session's connector for real, with the token its vault holds,
refreshing it when the connector says it lapsed.

## The agent's script

In place of a model, each line of a message that reads as a directive is one
step of the turn, one model request each, in order; the turn ends with a reply
naming the tools it called. Nothing else steers it.

| Line                        | Step                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `call <tool> <json object>` | calls that tool with that input, waiting first if it asks  |
| `spend <cents>`             | one model request that costs that many cents of list price |
| `stall`                     | keeps working until the session is interrupted             |

So `call create_note {"markdown":"Paris"}` makes a note in the library through
the connector, and `spend 30` three times spends past a 50-cent budget.

## Running it

`pnpm dev:web` starts it on its pinned port, 5177 (`docs/development.md`), and
`apps/web/.dev.vars.example` names it as `MANAGED_AGENTS_FAKE_URL`, a binding
only `vite dev` declares. `src/serve.ts` serves it on a port of a caller's own:
the e2e harness serves one beside each Worker it boots, on an ephemeral port
(`tools/e2e/src/harness/cloud-worker.ts`), and the Worker's suites call its
fetch handler in their own isolate (`apps/web/src/worker/test-support`).
