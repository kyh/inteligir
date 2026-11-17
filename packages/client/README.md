# @repo/client

What the library tab and the phone share above `@repo/contract`: how a device
asks what moved in the library and what each answer reads again, the library's
labels, the built-in agent's conversation logic, and the queue the phone and the
extension keep a save in until the cloud takes it. It names no platform and no UI, so each
device draws the same rows, words and sends its own way (the tab with
`@repo/ui`, the phone with React Native). Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/                one module per concern: what moved and what it reads again, the labels, a
                    thread's entries and a send, the waiting saves, each with its suite
src/test-support/   the key-value store a suite drives
```

## Testing

`pnpm --filter @repo/client test` runs each module's suite under node, what
moved under fake timers.
