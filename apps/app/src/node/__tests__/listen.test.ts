import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { listenWithRetry, type ListenResult } from "../listen";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function closeNetServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function occupyPort(): Promise<number> {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => closeNetServer(blocker));
  const address = blocker.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound AddressInfo");
  }
  return address.port;
}

function trackResult(result: ListenResult): ListenResult {
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        result.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );
  return result;
}

const okFetch = () => new Response("ok");

describe("listenWithRetry", () => {
  it("probes upward from a busy derived port and reports the winner", async () => {
    const busyPort = await occupyPort();
    const result = trackResult(
      await listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: busyPort,
        probeOnBusyPort: true,
      }),
    );
    expect(result.port).toBeGreaterThan(busyPort);
    expect(result.port).toBeLessThan(busyPort + 10);
  });

  it("refuses to probe a configured port", async () => {
    const busyPort = await occupyPort();
    await expect(
      listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: busyPort,
        probeOnBusyPort: false,
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("binds and reports the bound port", async () => {
    const result = trackResult(
      await listenWithRetry({
        fetch: okFetch,
        hostname: "127.0.0.1",
        port: 0,
        probeOnBusyPort: false,
      }),
    );
    expect(result.port).toBeGreaterThan(0);
  });
});
