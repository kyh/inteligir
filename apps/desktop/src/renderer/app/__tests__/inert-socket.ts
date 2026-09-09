// `WebSocket` stub for DOM suites: never connects, never fires.

/* oxlint-disable class-methods-use-this -- the socket's instance API: `new WebSocket()` reaches these on the instance, never as statics */
export class InertSocket {
  addEventListener = (): void => {};
  send = (): void => {};
  close = (): void => {};
}
