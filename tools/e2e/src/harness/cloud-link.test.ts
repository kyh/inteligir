import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCloudLink } from "./cloud-link";
import type { CloudLink } from "./cloud-link";

// the Worker the link relays to, answering each call and closing its connection, so no client
// keeps one alive across a cut
let worker: Server;
let link: CloudLink;

const workerOrigin = async (): Promise<string> =>
  // oxlint-disable-next-line promise/avoid-new -- node:http is event/callback only; listen has no promise form.
  await new Promise((resolve, reject) => {
    worker = createServer((_request, response) => {
      response.setHeader("connection", "close");
      response.end("the worker");
    });
    worker.once("error", reject);
    worker.listen(0, "127.0.0.1", () => {
      const address = worker.address();
      if (address instanceof Object) {
        resolve(`http://127.0.0.1:${String(address.port)}`);
      }
    });
  });

const answer = async (): Promise<string> => {
  const response = await fetch(link.origin);
  return await response.text();
};

beforeEach(async () => {
  link = await openCloudLink(await workerOrigin());
});

afterEach(async () => {
  await link.close();
  worker.close();
});

describe("the cloud link", () => {
  it("relays to the Worker, refuses while cut, and answers on its origin again once restored", async () => {
    await expect(answer()).resolves.toBe("the worker");
    await link.cut();
    await expect(answer()).rejects.toThrow("fetch failed");
    await link.restore();
    await expect(answer()).resolves.toBe("the worker");
  });

  it("drops a connection open through it at a cut", async () => {
    const socket = connect(Number(new URL(link.origin).port), "127.0.0.1");
    await once(socket, "connect");
    // oxlint-disable-next-line promise/avoid-new -- a drop may reset the socket, which `once` would reject on.
    const dropped = new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
    });
    socket.on("error", () => {
      // the relay may reset it rather than end it
    });
    await link.cut();
    await expect(dropped).resolves.toBeUndefined();
  });

  it("refuses a restore once closed, and stays closed", async () => {
    await link.close();
    await expect(link.restore()).rejects.toThrow("restore after it closed");
    await expect(answer()).rejects.toThrow("fetch failed");
  });

  it("cuts once a restore under way has listened, when the cut is asked meanwhile", async () => {
    await link.cut();
    await Promise.all([link.restore(), link.cut()]);
    await expect(answer()).rejects.toThrow("fetch failed");
    await link.restore();
    await expect(answer()).resolves.toBe("the worker");
  });

  it("closes for good once a restore under way has listened, when the close is asked meanwhile", async () => {
    await link.cut();
    await Promise.all([link.restore(), link.close()]);
    await expect(answer()).rejects.toThrow("fetch failed");
    await expect(link.restore()).rejects.toThrow("restore after it closed");
  });
});
