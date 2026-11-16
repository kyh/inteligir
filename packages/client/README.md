# @repo/client

What the library tab and the phone share above `@repo/contract`: the live
socket the account's and each note's are, what the account's frames read again, the library's labels, the
built-in agent's conversation logic, and the queue a device keeps a save in
until the cloud takes it. It names no platform and no UI, so each
device draws the same rows, words and sends its own way (the tab with
`@repo/ui`, the phone with React Native). Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/                one module per concern: the sockets, the cache's re-reads, the labels, a
                    thread's entries and a send, the waiting saves, each with its suite
src/test-support/   the fake sockets and the key-value store a suite drives
```

## Testing

`pnpm --filter @repo/client test` runs each module's suite under node, the
socket's under fake timers.
