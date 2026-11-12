// The account's socket as the suites dial it: a WebSocket class whose every socket a suite opens,
// writes frames into or drops by hand, with the pings sent on each.

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export const fakeSockets = () => {
  const sockets: FakeSocket[] = [];

  class FakeSocket extends EventTarget {
    readyState = CONNECTING;
    binaryType = "blob";
    readonly url: string;
    readonly sent: string[] = [];
    // the client closed it, as a drop does not
    closed = false;

    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
    }

    send(data: string): void {
      this.sent.push(data);
    }

    close(): void {
      this.closed = true;
      this.drop();
    }

    open(): void {
      this.readyState = OPEN;
      this.dispatchEvent(new Event("open"));
    }

    message(data: string): void {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }

    // the connection goes without the client closing it
    drop(): void {
      this.readyState = CLOSED;
      this.dispatchEvent(new Event("close"));
    }
  }

  // every socket dialled, oldest first
  return { sockets, WebSocket: FakeSocket };
};

export type FakeSockets = ReturnType<typeof fakeSockets>;
