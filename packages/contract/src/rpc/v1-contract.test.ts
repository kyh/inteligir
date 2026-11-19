import { COMMON_ERROR_STATUS_MAP, createORPCClient, isDefinedError, safe } from "@orpc/client";
import type { PromiseWithError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AnyProcedureContract, AnySchema, RouterContract } from "@orpc/contract";
import { getAsyncIteratorObjectSchemasDetails } from "@orpc/contract";
import { implement, walkProcedureContractsSync } from "@orpc/server";
import type { AnyRouter } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { utf8ByteLength } from "../library/canonical-json";
import type { BodyBlock } from "../library/derive-item";
import { BODY_MAX_BYTES, itemReadSchema, liveItemRowSchema } from "../library/library-wire";
import { V1_RPC_PATH, v1Contract } from "./v1-contract";
import type { V1Client } from "./v1-contract";
import { V1_CUSTOM_ERROR_STATUS, V1_ERROR_STATUS_MAP } from "./v1-errors";

interface Row {
  readonly path: string;
  readonly contract: AnyProcedureContract;
}

const rowsOf = (router: RouterContract) => {
  const rows: Row[] = [];
  walkProcedureContractsSync(router, (contract, path) => {
    rows.push({ contract, path: path.join(".") });
  });

  return rows;
};

const ROWS = rowsOf(v1Contract);

const zodOf = (schema: AnySchema) => {
  if (!(schema instanceof z.ZodType)) {
    throw new TypeError("every /v1 schema is zod");
  }

  return schema;
};

const schemasOf = (schemas: AnySchema | readonly AnySchema[] | undefined) => {
  const listed = schemas === undefined ? [] : [schemas].flat();
  const streamed = getAsyncIteratorObjectSchemasDetails(listed);

  return (
    streamed === undefined ? listed : [...streamed.yieldSchemas, ...streamed.returnSchemas]
  ).map(zodOf);
};

const jsonObjectSchema = z.looseObject({
  properties: z.record(z.string(), z.json()).optional(),
  required: z.array(z.string()).optional(),
});

const LIBRARY_READS = new Set([
  "agent.events",
  "agent.list",
  "agent.rules",
  "agent.status",
  "agent.undoable",
  "changes",
  "files.reserve",
  "guide",
  "imports.named",
  "imports.settle",
  "items.get",
  "items.list",
  "items.read",
  "items.row",
  "listing.page",
  "listing.scopes",
  "listing.titles",
  "organize.outline",
  "search",
]);

const RESENT_UNKEYED = new Set(["agent.undo", "files.settle", "items.saveBody"]);

const UUID_V7 = "01890a5d-ac96-774b-bcce-b302099a8057";
const UUID_V4 = "4c0b1f2a-8d3e-4f6a-9b1c-2d3e4f5a6b7c";
const SHA = "a".repeat(64);

const FILE = {
  folderId: null,
  id: UUID_V7,
  name: "report.pdf",
  savedAt: 1_700_000_000_000,
  sha: SHA,
  tags: [],
};

const heavyBlock = (at: number) =>
  ({
    block: { children: [{ text: "é".repeat(1000) }], id: `b${String(at)}`, type: "p" },
    section: "note",
  }) satisfies BodyBlock;

interface ErrorCase {
  readonly code: keyof typeof V1_CUSTOM_ERROR_STATUS;
  readonly data: unknown;
  readonly router: AnyRouter;
  readonly refusal: (client: V1Client) => Promise<Refusal | null>;
}

interface Refusal {
  readonly code: string;
  readonly data: unknown;
}

const refusalOf = async <T, E>(promise: PromiseWithError<T, E>) => {
  const { error } = await safe(promise);

  return (
    isDefinedError(error) ? { code: error.code, data: error.data } : null
  ) satisfies Refusal | null;
};

const served = (router: AnyRouter) => {
  const handler = new RPCHandler(router, { errorStatusMap: V1_ERROR_STATUS_MAP });
  const sent: number[] = [];
  const statuses: number[] = [];

  const link = new RPCLink({
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body = await request.clone().arrayBuffer();
      sent.push(body.byteLength);

      const { response } = await handler.handle(request, {
        context: {},
        prefix: V1_RPC_PATH,
      });

      const answer = response ?? new Response(null, { status: 404 });
      statuses.push(answer.status);

      return answer;
    },
    origin: "http://v1.test",
    url: V1_RPC_PATH,
  });

  return { client: createORPCClient<V1Client>(link), sent, statuses };
};

describe("/v1's error statuses", () => {
  const declared = new Set(ROWS.flatMap((row) => Object.keys(row.contract["~orpc"].errorMap)));
  const custom = [...declared].filter((code) => !Object.hasOwn(COMMON_ERROR_STATUS_MAP, code));

  it("maps every code a row declares", () => {
    expect([...declared].filter((code) => !Object.hasOwn(V1_ERROR_STATUS_MAP, code))).toStrictEqual(
      [],
    );
  });

  it("maps exactly the custom codes the rows declare, none of oRPC's own", () => {
    expect(Object.keys(V1_CUSTOM_ERROR_STATUS).toSorted()).toStrictEqual(custom.toSorted());
  });

  it("answers an outage 5xx and every refusal at least 4xx", () => {
    expect(V1_ERROR_STATUS_MAP.SERVICE_UNAVAILABLE).toBeGreaterThanOrEqual(500);

    for (const status of Object.values(V1_CUSTOM_ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  const os = implement(v1Contract);

  const cases: readonly ErrorCase[] = [
    {
      code: "AGENT_BUDGET",
      data: { resetsAt: 1_700_000_000_000 },
      refusal: async (client) =>
        await refusalOf(client.library.agent.send({ text: "tidy my reading list" })),
      router: {
        library: {
          agent: {
            send: os.library.agent.send.handler(({ errors }) => {
              throw errors.AGENT_BUDGET({ data: { resetsAt: 1_700_000_000_000 } });
            }),
          },
        },
      },
    },
    {
      code: "BLOB_MISSING",
      data: { shas: [SHA] },
      refusal: async (client) => await refusalOf(client.library.items.createFile(FILE)),
      router: {
        library: {
          items: {
            createFile: os.library.items.createFile.handler(({ errors }) => {
              throw errors.BLOB_MISSING({ data: { shas: [SHA] } });
            }),
          },
        },
      },
    },
    {
      code: "CLIENT_OUTDATED",
      data: undefined,
      refusal: async (client) => await refusalOf(client.account.devices.list()),
      router: {
        account: {
          devices: {
            list: os.account.devices.list.handler(({ errors }) => {
              throw errors.CLIENT_OUTDATED();
            }),
          },
        },
      },
    },
    {
      code: "INVALID_CREDENTIALS",
      data: undefined,
      refusal: async (client) => await refusalOf(client.account.delete({ password: "password1" })),
      router: {
        account: {
          delete: os.account.delete.handler(({ errors }) => {
            throw errors.INVALID_CREDENTIALS();
          }),
        },
      },
    },
    {
      code: "QUOTA",
      data: { bytesCap: 1024 ** 3, bytesUsed: 1024 ** 3 },
      refusal: async (client) => await refusalOf(client.library.items.createFile(FILE)),
      router: {
        library: {
          items: {
            createFile: os.library.items.createFile.handler(({ errors }) => {
              throw errors.QUOTA({ data: { bytesCap: 1024 ** 3, bytesUsed: 1024 ** 3 } });
            }),
          },
        },
      },
    },
  ];

  it("is exercised for every custom code", () => {
    expect(cases.map((sample) => sample.code).toSorted()).toStrictEqual(
      Object.keys(V1_CUSTOM_ERROR_STATUS).toSorted(),
    );
  });

  it.each(cases)("answers $code with its status and its typed data", async (sample) => {
    const { client, statuses } = served(sample.router);
    await expect(sample.refusal(client)).resolves.toStrictEqual({
      code: sample.code,
      data: sample.data,
    });
    expect(statuses).toStrictEqual([V1_CUSTOM_ERROR_STATUS[sample.code]]);
  });
});

describe("/v1's rows", () => {
  it("takes an optional opId on every library write, so a resend lands once", () => {
    const writes = rowsOf(v1Contract.library).filter(
      (row) => !LIBRARY_READS.has(row.path) && !RESENT_UNKEYED.has(row.path),
    );

    expect(writes.length).toBeGreaterThan(0);

    for (const row of writes) {
      const [input] = schemasOf(row.contract["~orpc"].inputSchemas);

      const json = jsonObjectSchema.parse(
        input === undefined ? {} : z.toJSONSchema(input, { io: "input" }),
      );

      expect({ opId: Object.hasOwn(json.properties ?? {}, "opId"), row: row.path }).toStrictEqual({
        opId: true,
        row: row.path,
      });
      expect(json.required ?? []).not.toContain("opId");
    }
  });

  it("names no row after a property every function has, which a client's path would read", () => {
    const reserved = new Set(Object.getOwnPropertyNames(Function.prototype));
    expect(
      ROWS.filter((row) => row.path.split(".").some((segment) => reserved.has(segment))),
    ).toStrictEqual([]);
  });

  it("names every row it exempts", () => {
    const paths = new Set(rowsOf(v1Contract.library).map((row) => row.path));
    expect([...LIBRARY_READS, ...RESENT_UNKEYED].filter((path) => !paths.has(path))).toStrictEqual(
      [],
    );
  });

  it("converts every input and output to JSON Schema, as the connector and its tools need", () => {
    for (const row of ROWS) {
      const { inputSchemas, outputSchemas } = row.contract["~orpc"];

      for (const schema of schemasOf(inputSchemas)) {
        expect(() => z.toJSONSchema(schema, { io: "input" }), row.path).not.toThrow();
      }

      for (const schema of schemasOf(outputSchemas)) {
        expect(() => z.toJSONSchema(schema, { io: "output" }), row.path).not.toThrow();
      }
    }
  });
});

describe("the library's wire", () => {
  it("drops a field a newer cell adds to a row, rather than refusing the row", () => {
    const row = {
      card: { outline: [], preview: "", title: "Ada", words: 0 },
      fields: {
        aliases: [],
        author: null,
        coverSha: null,
        deletedAt: null,
        description: null,
        folderId: null,
        kind: "note",
        lang: null,
        originalName: null,
        originalSha: null,
        pinnedAt: null,
        properties: {},
        published: null,
        reading: { state: "none" },
        savedAt: 1,
        site: null,
        tags: [],
        title: "Ada",
        url: null,
      },
      id: UUID_V7,
      seq: 3,
      updatedAt: 1,
    };

    const parsed = liveItemRowSchema.parse({
      ...row,
      fields: { ...row.fields, rating: 5, reading: { state: "none", tries: 2 } },
      later: true,
    });

    expect(parsed).toStrictEqual(row);
  });

  it("says when an item's page was read, as the item's own reading always does", () => {
    const { reading } = itemReadSchema.shape.fields.shape;
    const at = "2026-10-01T00:00:00.000Z";
    expect(reading.validate({ at: null, state: "read" })).toBe(false);
    expect(reading.validate({ at, state: "read" })).toBe(true);
    expect(reading.validate({ at: null, state: "pending" })).toBe(true);
    expect(reading.validate({ at: null, error: "Timed out.", state: "failed" })).toBe(true);
  });

  it("carries a body as heavy as a body may be in a save a function takes", async () => {
    const blocks = [];

    for (let bytes = 1; bytes < BODY_MAX_BYTES; bytes += 1) {
      const next = heavyBlock(blocks.length);
      blocks.push(next);
      bytes += utf8ByteLength(JSON.stringify(next));
    }

    expect(utf8ByteLength(JSON.stringify(blocks))).toBeGreaterThanOrEqual(BODY_MAX_BYTES);
    const os = implement(v1Contract);
    const received: number[] = [];

    const { client, sent } = served({
      library: {
        items: {
          saveBody: os.library.items.saveBody.handler(({ input }) => {
            received.push(input.blocks.length);

            return { kind: "full", maxBytes: BODY_MAX_BYTES };
          }),
        },
      },
    });

    await expect(
      client.library.items.saveBody({ baseVersion: 1, blocks, id: UUID_V7 }),
    ).resolves.toStrictEqual({ kind: "full", maxBytes: BODY_MAX_BYTES });
    expect(received).toStrictEqual([blocks.length]);
    const [bytes] = sent;
    expect(bytes).toBeGreaterThan(BODY_MAX_BYTES);
    expect(bytes).toBeLessThan(4_500_000);
  });

  it("refuses a title for many items and a write that changes nothing", () => {
    const organize = v1Contract.library.items.organize["~orpc"].inputSchemas;
    const [schema] = schemasOf(organize);
    expect(schema?.validate({ ids: [UUID_V7], title: "One" })).toBe(true);
    expect(schema?.validate({ ids: [UUID_V7, UUID_V4], title: "Both" })).toBe(false);
    const [write] = schemasOf(v1Contract.library.write["~orpc"].inputSchemas);
    expect(write?.validate({ itemId: UUID_V7, ops: [] })).toBe(false);
  });

  it("takes a property's op alone on a write, so no device sets a field the cell's verbs move", () => {
    const [write] = schemasOf(v1Contract.library.write["~orpc"].inputSchemas);

    const ops = [
      { key: "status", op: "property", value: "draft" },
      {
        base: { state: "none" },
        field: "reading",
        op: "set",
        value: { at: null, state: "pending" },
      },
      { base: 1, field: "deletedAt", op: "set", value: null },
      { base: [], op: "tags", value: ["later"] },
    ];

    expect(ops.map((op) => write?.validate({ itemId: UUID_V7, ops: [op] }))).toStrictEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
