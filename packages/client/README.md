# @repo/client

What the library tab and the phone share above `@repo/contract`: the account's
socket, what each of its frames reads again, the library's labels, and the
built-in agent's conversation logic. It names no platform and no UI, so each
device draws the same rows, words and sends its own way (the tab with
`@repo/ui`, the phone with React Native). Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/                one module per concern: the socket, the cache's re-reads, the labels, a
                    thread's entries and a send, each with its suite
src/test-support/   the fake sockets a suite drives
```

## Testing

`pnpm --filter @repo/client test` runs each module's suite under node, the
socket's under fake timers.
