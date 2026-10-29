# @repo/messages-fake

A scripted Claude Messages API with no model and no account behind it. The
local Worker (`pnpm dev:web`), the e2e scenarios and the Worker's suites run
the built-in agent against it, through the SDK's `baseURL` or as its `fetch`,
so every conversation's object runs the one code path it runs deployed
(`apps/web/src/worker/agent/anthropic-client.ts`).

It answers `POST /v1/messages` and AI Gateway's provider-native path to it
(`/v1/<account>/<gateway>/anthropic/v1/messages`), only a streamed request that
carries the gateway's `cf-aig-authorization` header, and streams the
documented events: thinking, text and tool calls with their deltas, every
usage field with the 5-minute and 1-hour cache writes apart, and
`input_transformations` when the thinking-binding beta is sent. Usage is
deterministic: a quarter of a block's characters, rounded up, everything
before the request's last breakpoint read from the cache, the block carrying
it written at its lifetime.

It refuses with a 400, in the API's words, what Claude Opus 5.5 refuses
(`src/fake-request.ts`): sampling parameters, thinking other than adaptive, a
forced tool choice, a field on a message other than its role and content, an
assistant message last, a system message out of place, a tool call with no
result next, more than four breakpoints or a 1-hour one after a 5-minute one,
and a breakpoint on a thinking block. It signs every thinking block it sends
against the system, the tools and every message before it, chained to the
block before (`src/fake-signature.ts`), so a request that leaves out a leading
run of thinking blocks still verifies and any other edit does not: refused, or
under `drop_block` dropped and counted. Every suite and scenario expects no
drop.

## The agent's script

In place of a model, the directive lines of the person's latest message are
the turn's steps, one model call each, the step found by counting the replies
since that message (`src/fake-script.ts`). With no step left, the reply ends
the turn naming the tools it called. Nothing else steers it.

| Line                        | Step                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `call <tool> <json object>` | a reply that thinks, then calls that tool with that input             |
| `spend <cents>`             | a reply whose output costs that many cents, cut at `max_tokens`       |
| `long <chars>`              | a reply of that much text, streamed slowly                            |
| `refuse <category>`         | a refusal no fallback takes up                                        |
| `fallback`                  | a refusal the request's `fallbacks` take up, answered by the fallback |
| `stall [thinking]`          | the next reply holds mid-stream the first time, until the client goes |
| `fail <status> <times>`     | each request body is answered that status that many times first       |

So `call create_note {"title":"Paris","markdown":"Paris"}` asks the thread to
run that tool through the account's cell, and `spend 30` twice spends past a
turn's ceiling.

## Running it

`pnpm dev:web` starts it on its pinned port, 5177 (`docs/development.md`), and
`apps/web/.dev.vars.example` names it as `ANTHROPIC_FAKE_URL`, a binding only
`vite dev` declares. `src/serve.ts` serves it on a port of a caller's own: the
e2e harness serves one beside each Worker it boots, on an ephemeral port
(`tools/e2e/src/harness/cloud-worker.ts`), and the Worker's suites call its
fetch handler in their own isolate (`apps/web/src/worker/test-support`). Its
counters, the requests answered and the thinking blocks dropped, answer at
`GET /__fake/stats`.
