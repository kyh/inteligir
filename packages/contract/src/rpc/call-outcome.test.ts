import { createORPCErrorFromJson } from "@orpc/client";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { V1_RPC_PATH, v1Contract } from "./v1-contract";
import type { V1Client } from "./v1-contract";
import { refusalResponse } from "../test-support/refusal-response.test-utils";
import {
  BlobMismatchError,
  ClientOutdatedError,
  QuotaError,
  TooManyRequestsError,
  V1_ERROR_STATUS_MAP,
} from "./v1-errors";
import { outcomeOf, sessionEndOf, sharedFailure, uploadBlob } from "./call-outcome";
import type { CallOutcome, SessionEnd, V1Transport } from "./call-outcome";

const CHANGE_REFUSED = "Your library couldn't take this change.";
const ORIGIN = "http://localhost:5174";

const FILE = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", sha: "a".repeat(64) };

type Files = V1Client["library"]["files"];

type Reserved = Awaited<ReturnType<Files["reserve"]>>;

type Settled = Awaited<ReturnType<Files["settle"]>>;

const TO_THE_STORE: Reserved = {
  headers: { "content-type": FILE.mime },
  kind: "upload",
  uploadId: "upload-1",
  url: "/store/upload-1",
};

const elsewhere = setupServer();

beforeAll(() => {
  elsewhere.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  elsewhere.resetHandlers();
});

afterAll(() => {
  elsewhere.close();
});

interface Script {
  readonly reserve?: () => Reserved;
  readonly store?: () => Response;
  readonly settle?: () => Settled;
  readonly busy?: () => Response;
}

const spentMinute = (retryAfter: string | null) => () => {
  const refused = refusalResponse(new TooManyRequestsError());

  if (retryAfter !== null) {
    refused.headers.set("retry-after", retryAfter);
  }

  return refused;
};

const cloudOf = (script: Script) => {
  const asked: string[] = [];
  const stored: { readonly bytes: Uint8Array; readonly type: string | null }[] = [];
  const os = implement(v1Contract);

  const handler = new RPCHandler(
    {
      library: {
        files: {
          reserve: os.library.files.reserve.handler(() =>
            (script.reserve ?? (() => TO_THE_STORE))(),
          ),
          settle: os.library.files.settle.handler(({ input }) => {
            expect(input).toStrictEqual({ sha: FILE.sha, uploadId: "upload-1" });

            return (script.settle ?? (() => ({ kind: "kept" }) satisfies Settled))();
          }),
        },
      },
    },
    { errorStatusMap: V1_ERROR_STATUS_MAP },
  );

  const transport: V1Transport = {
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      const call = `${request.method} ${pathname}`;
      const firstTry = !asked.includes(call);
      asked.push(call);

      if (pathname.startsWith(V1_RPC_PATH)) {
        if (firstTry && script.busy !== undefined) {
          return script.busy();
        }

        const { response } = await handler.handle(request, { prefix: V1_RPC_PATH });

        return response ?? new Response(null, { status: 404 });
      }

      stored.push({
        bytes: new Uint8Array(await request.arrayBuffer()),
        type: request.headers.get("content-type"),
      });

      return (script.store ?? (() => new Response(null, { status: 200 })))();
    },
    origin: ORIGIN,
  };

  return { asked, stored, transport };
};

const RESERVE = `POST ${V1_RPC_PATH}/library/files/reserve`;
const SETTLE = `POST ${V1_RPC_PATH}/library/files/settle`;

describe(uploadBlob, () => {
  it("sends nothing of a file the library holds", async () => {
    const cloud = cloudOf({ reserve: () => ({ kind: "held" }) });
    await expect(uploadBlob(cloud.transport, FILE)).resolves.toBeUndefined();
    expect(cloud.asked).toStrictEqual([RESERVE]);
  });

  it("puts the bytes where the reserve named, as the type it named, then settles them", async () => {
    const cloud = cloudOf({});
    await expect(uploadBlob(cloud.transport, FILE)).resolves.toBeUndefined();
    expect(cloud.asked).toStrictEqual([RESERVE, "PUT /store/upload-1", SETTLE]);
    expect(cloud.stored).toStrictEqual([{ bytes: FILE.bytes, type: FILE.mime }]);
  });

  it("sends a store elsewhere the bytes with none of the session's credentials", async () => {
    const cloud = cloudOf({
      reserve: () => ({ ...TO_THE_STORE, url: "https://store.example/put?signature=s" }),
    });

    const sent: Request[] = [];

    elsewhere.use(
      http.put("https://store.example/put", ({ request }) => {
        sent.push(request);

        return new HttpResponse(null, { status: 200 });
      }),
    );

    const signed: V1Transport = {
      fetch: async (request) => {
        const headers = new Headers(request.headers);
        headers.set("authorization", "Bearer session");

        return await cloud.transport.fetch(new Request(request, { headers }));
      },
      origin: ORIGIN,
    };

    await expect(uploadBlob(signed, FILE)).resolves.toBeUndefined();
    expect(cloud.asked).toStrictEqual([RESERVE, SETTLE]);
    const [put] = sent;
    expect(put?.url).toBe("https://store.example/put?signature=s");
    expect(put?.method).toBe("PUT");
    expect(put?.credentials).toBe("omit");
    expect(put?.headers.get("authorization")).toBeNull();
    expect(put?.headers.get("content-type")).toBe(FILE.mime);
  });

  it("throws the refusal a settle declared, as a call's link does", async () => {
    for (const refusal of [
      new BlobMismatchError(),
      new QuotaError({ data: { bytesCap: 10, bytesUsed: 10 } }),
    ]) {
      const cloud = cloudOf({
        settle: () => {
          throw refusal;
        },
      });

      await expect(uploadBlob(cloud.transport, FILE), refusal.code).rejects.toMatchObject({
        code: refusal.code,
        data: refusal.data,
        defined: true,
        message: refusal.message,
      });
    }
  });

  it("reads a store that refused the bytes, or no answer, as no refusal, and settles nothing", async () => {
    for (const store of [
      () => new Response("expired", { status: 403 }),
      () => new Response(null, { status: 400 }),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ]) {
      const cloud = cloudOf({ store });
      await expect(uploadBlob(cloud.transport, FILE)).rejects.toSatisfy(
        (thrown: Error) => sharedFailure(thrown)?.kind === "unreachable",
      );
      expect(cloud.asked).not.toContain(SETTLE);
    }
  });

  it("waits out each busy answer that names its wait, sending the call again, and lands", async () => {
    const cloud = cloudOf({ busy: spentMinute("0") });
    await expect(uploadBlob(cloud.transport, FILE)).resolves.toBeUndefined();
    expect(cloud.asked).toStrictEqual([RESERVE, RESERVE, "PUT /store/upload-1", SETTLE, SETTLE]);
  });

  it("throws a busy answer that names no wait, as a budget to wait out", async () => {
    const cloud = cloudOf({ busy: spentMinute(null) });
    await expect(uploadBlob(cloud.transport, FILE)).rejects.toSatisfy(
      (thrown: Error) => sharedFailure(thrown)?.kind === "busy",
    );
    expect(cloud.asked).toStrictEqual([RESERVE]);
  });

  it("tells the hook a sign-in it ended", async () => {
    const ended: SessionEnd[] = [];

    const cloud = cloudOf({
      reserve: () => {
        throw new ClientOutdatedError();
      },
    });

    await expect(
      uploadBlob(cloud.transport, FILE, (end) => {
        ended.push(end);
      }),
    ).rejects.toMatchObject({ code: "CLIENT_OUTDATED", defined: true });
    expect(ended).toStrictEqual(["outdated"]);
  });
});

const defined = (code: string, message = code) =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message });

const undeclared = (code: string) =>
  createORPCErrorFromJson({ code, data: undefined, defined: false, message: code });

describe(sessionEndOf, () => {
  it("ends the sign-in on a signed-out, deleted or outdated one, and on nothing else", () => {
    expect(sessionEndOf(defined("UNAUTHORIZED"))).toBe("signed-out");
    expect(sessionEndOf(defined("GONE"))).toBe("gone");
    expect(sessionEndOf(defined("CLIENT_OUTDATED"))).toBe("outdated");
    expect(sessionEndOf(defined("INVALID_CREDENTIALS"))).toBeNull();
    expect(sessionEndOf(new Error("offline"))).toBeNull();
  });
});

const WAITS_FOR_CONNECTION = { for: "connection", kind: "wait" } as const;

describe(outcomeOf, () => {
  it("answers what the call did", async () => {
    await expect(outcomeOf(async () => "the answer")).resolves.toStrictEqual({
      answer: "the answer",
      kind: "landed",
    });
  });

  it("reads every miss one way: a later try may pass, no resend does, or the account is gone", async () => {
    const misses: readonly (readonly [string, unknown, CallOutcome<never>])[] = [
      ["a session the cloud ended", defined("UNAUTHORIZED"), { for: "sign-in", kind: "wait" }],
      ["a build too old", defined("CLIENT_OUTDATED"), { for: "update", kind: "wait" }],
      ["the cloud's budget", defined("TOO_MANY_REQUESTS"), WAITS_FOR_CONNECTION],
      ["no connection", new TypeError("Failed to fetch"), WAITS_FOR_CONNECTION],
      ["the call's deadline", new DOMException("timed out", "TimeoutError"), WAITS_FOR_CONNECTION],
      ["a fault of the cloud's", undeclared("INTERNAL_SERVER_ERROR"), WAITS_FOR_CONNECTION],
      ["a throw that is no error", "offline", WAITS_FOR_CONNECTION],
      ["the account deleted", defined("GONE"), { kind: "gone" }],
      [
        "a refusal of the call's own, in its words",
        defined("QUOTA", "Your library is full."),
        { code: "QUOTA", kind: "refused", message: "Your library is full." },
      ],
      [
        "a refusal that says nothing",
        defined("CONFLICT", ""),
        { code: "CONFLICT", kind: "refused", message: CHANGE_REFUSED },
      ],
      [
        "input the cloud refused",
        undeclared("BAD_REQUEST"),
        { code: "BAD_REQUEST", kind: "refused", message: CHANGE_REFUSED },
      ],
    ];

    for (const [met, thrown, outcome] of misses) {
      await expect(
        outcomeOf(async () => {
          throw thrown;
        }),
        met,
      ).resolves.toStrictEqual(outcome);
    }
  });

  it("reads a file's upload as any call, the sha its answer", async () => {
    const sent = async (script: Script) =>
      await outcomeOf(async () => {
        await uploadBlob(cloudOf(script).transport, FILE);

        return FILE.sha;
      });

    await expect(sent({})).resolves.toStrictEqual({ answer: FILE.sha, kind: "landed" });
    await expect(
      sent({
        settle: () => {
          throw new BlobMismatchError();
        },
      }),
    ).resolves.toStrictEqual({
      code: "BAD_REQUEST",
      kind: "refused",
      message: "This file changed on this device before it was sent.",
    });
    await expect(sent({ store: () => new Response(null, { status: 403 }) })).resolves.toStrictEqual(
      WAITS_FOR_CONNECTION,
    );
  });
});
