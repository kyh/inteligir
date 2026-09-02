// The provider's invalidation socket, inert: a DOM suite that mounts the
// workspace runtime without riding the bus stubs `WebSocket` with this. It
// never connects and never fires, so nothing under test can wait on it.

export class InertSocket {
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}
