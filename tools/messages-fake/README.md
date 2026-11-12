# @repo/messages-fake

A scripted Claude Messages API with no model and no account behind it. The
local Worker (`pnpm dev:web`), the e2e flows and the Worker's suites run
the built-in agent against it, through the SDK's `baseURL` or as its `fetch`,
so every conversation's object runs the one code path it runs deployed
(`packages/service/src/agent/anthropic-client.ts`).

It answers `POST /v1/messages`, only a streamed request that carries the
gateway's `cf-aig-authorization` header and a `cf-aig-metadata` object naming
its `account`, which the gateway's per-account spend limit splits by, and
streams the documented events:
thinking, text, tool calls and compaction with their deltas, every usage field
with the 5-minute and 1-hour cache writes apart,
`usage.iterations` on every reply when the compaction beta is sent, and
`input_transformations` when the thinking-binding beta is sent. Usage is
deterministic: a quarter of a block's characters, rounded up, everything
before the request's last breakpoint read from the cache, the block carrying
it written at its lifetime. A reply's thinking shows what `thinking.display`
asks for: under `updates`, the progress note it writes before each tool call
and nothing of its reasoning; under `summarized`, both; otherwise nothing.

It refuses with a 400, in the API's words, what Claude Sonnet 5.5 refuses
(`src/fake-request.ts`): sampling parameters, thinking other than adaptive, a
forced tool choice, a field on a message other than its role and content, an
assistant message last, a system message out of place, a tool call with no
result next, more than four breakpoints or a 1-hour one after a 5-minute one,
a breakpoint on a thinking block, a beta's field without its beta, and a
compaction trigger other than input tokens or under 50,000 of them. It signs
every thinking block it sends against the system, the tools and every message
before it, chained to the block before (`src/fake-signature.ts`), so a request
that leaves out a leading run of thinking blocks still verifies and any other
edit does not: refused, or under `drop_block` dropped and counted. Every suite
and flow expects no drop: the Worker's suites read the count after each test,
and the e2e fixture as it tears down each Worker it booted
(`tools/e2e/src/fixtures.ts`). Once a conversation holds a compaction
block that kept a summary, the fake reads it from its last one on, as the API
does: what came before is ignored, the prefix a thinking block is bound to
starts at the block, and the chain starts afresh there. A compaction block whose
content is null, a summary not written, is ignored itself, and compacts nothing.

## The agent's script

In place of a model, the directive lines of the person's latest message are
the turn's steps, one model call each, the step found by counting the replies
since that message (`src/fake-script.ts`). With no step left, the reply ends
the turn naming the tools it called. Nothing else steers it.

| Line                              | Step                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `call <tool> <json object>`       | a reply that thinks, then calls that tool with that input                              |
| `long <chars>`                    | a reply of that much text, streamed slowly                                             |
| `refuse <category>`               | a refusal no fallback takes up                                                         |
| `fallback`                        | a refusal the request's `fallbacks` take up, answered by the fallback                  |
| `stall [thinking]`                | the next reply holds mid-stream the first time, until the client goes                  |
| `fail <status> <times> [gateway]` | each body is answered that status that many times first, by the gateway with `gateway` |
| `compact`                         | the next reply opens with a compaction block, when the request asks                    |

`stall` and `compact` take no step of their own: each marks the step after
it, or the closing reply. A compaction's summary keeps, in its opaque
`encrypted_content`, the person's words and the replies since them, which is
all a request sent from the block on tells the fake of them; its sampling is
an entry of its own in `usage.iterations`.

So `call create_note {"title":"Paris","markdown":"Paris"}` asks the thread to
run that tool through the account's cell, and `fail 429 1 gateway` answers as
the gateway's spend limit, spent.

## Running it

`pnpm dev:web` starts it on its pinned port, 5177 (`docs/development.md`), and
`.env.example` names it as `ANTHROPIC_FAKE_URL`, a binding only `vite dev`
declares. `src/serve.ts` serves it on a port of a caller's own: the e2e
fixture serves one beside each Worker it boots, on an ephemeral port, and binds
it there (`tools/e2e/src/fixtures.ts`), and the Worker's suites answer
its address with its fetch handler from their outbound service, which refuses
every other (`packages/service/messages-service.ts`). Its
counters, the requests answered, the replies a stall held open and the
thinking blocks dropped, answer at `GET /__fake/stats`, and to a caller in
the serving process through `serveMessagesFake`'s `stats`.
