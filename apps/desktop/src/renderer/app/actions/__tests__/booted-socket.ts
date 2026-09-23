import type { BootedTestApp } from "inteligir/server/testing";
import { vi } from "vitest";

type BusSocket = Parameters<BootedTestApp["bus"]["registerClient"]>[0];

const OPEN = 1;
const CLOSED = 3;

// the renderer's `WebSocket`, dialled straight into the booted bus: the frames the server would
// send, with no listener in between.
export const routeRendererSocket = (booted: BootedTestApp): void => {
  class BusSocketStub extends EventTarget {
    private readonly server: BusSocket = {
      close: () => {
        this.close();
      },
      readyState: OPEN,
      send: (data) => {
        this.dispatchEvent(new MessageEvent("message", { data }));
      },
    };

    constructor() {
      super();
      // after the caller has attached its listeners, as a real socket opens.
      queueMicrotask(() => {
        booted.bus.registerClient(this.server);
        this.dispatchEvent(new Event("open"));
      });
    }

    send(data: string): void {
      booted.bus.handleMessage(this.server, data);
    }

    close(): void {
      if (this.server.readyState === CLOSED) {
        return;
      }
      this.server.readyState = CLOSED;
      booted.bus.unregisterClient(this.server);
      this.dispatchEvent(new Event("close"));
    }
  }
  vi.stubGlobal("WebSocket", BusSocketStub);
};
