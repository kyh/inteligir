import { COMMON_ERROR_STATUS_MAP, createORPCClient, isDefinedError, safe } from "@orpc/client";
import type { PromiseWithError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AnyProcedureContract, AnySchema, RouterContract } from "@orpc/contract";
import { implement, walkProcedureContractsSync } from "@orpc/server";
import type { AnyRouter } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LIBRARY_CHANGE_KINDS } from "@repo/notes/library/library-schema";

import {
  agentViewContextSchema,
  annotationOpSchema,
  libraryChangeSchema,
  liveItemRowSchema,
  newIdSchema,
} from "./library/library-wire";
import { V1_RPC_PATH, v1Contract } from "./v1-contract";
import type { V1Client } from "./v1-contract";
import { V1_CUSTOM_ERROR_STATUS, V1_ERROR_STATUS_MAP } from "./v1-errors";

interface Row {
  readonly path: string;
  readonly contract: AnyProcedureContract;
}

const rowsOf = (router: RouterContract): Row[] => {
  const rows: Row[] = [];
  walkProcedureContractsSync(router, (contract, path) => {
    rows.push({ contract, path: path.join(".") });
  });
  return rows;
};

const ROWS = rowsOf(v1Contract);

const zodOf = (schema: AnySchema): z.ZodType => {
  if (!(schema instanceof z.ZodType)) {
    throw new TypeError("every /v1 schema is zod");
  }
  return schema;
};

const schemasOf = (schemas: AnySchema | readonly AnySchema[] | undefined): z.ZodType[] =>
  (schemas === undefined ? [] : [schemas].flat()).map(zodOf);

const jsonObjectSchema = z.looseObject({
  properties: z.record(z.string(), z.json()).optional(),
  required: z.array(z.string()).optional(),
});

// the library rows that write nothing, so take no opId
const LIBRARY_READS = new Set([
  "agent.events",
  "agent.list",
  "agent.status",
  "annotations.list",
  "history.list",
  "history.revision",
  "items.list",
  "items.read",
  "organize.outline",
  "search",
  "sync.bodies",
  "sync.pull",
]);

const UUID_V7 = "01890a5d-ac96-774b-bcce-b302099a8057";
const UUID_V4 = "4c0b1f2a-8d3e-4f6a-9b1c-2d3e4f5a6b7c";
const SHA = "a".repeat(64);

const SIGN_IN = { deviceName: "Mac", email: "a@example.com", password: "password1" };
const SIGN_UP = { ...SIGN_IN, inviteCode: "invite-123", name: "Ada" };

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

// what a call was refused with, when it was refused with an error its row declares
const refusalOf = async <T, E>(promise: PromiseWithError<T, E>): Promise<Refusal | null> => {
  const { error } = await safe(promise);
  return isDefinedError(error) ? { code: error.code, data: error.data } : null;
};

// a client over a real RPCHandler answering from `router`, and the status its last answer carried
const served = (router: AnyRouter) => {
  const handler = new RPCHandler(router, { errorStatusMap: V1_ERROR_STATUS_MAP });
  const statuses: number[] = [];
  const link = new RPCLink({
    fetch: async (url, init) => {
      const { response } = await handler.handle(new Request(url, init), {
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
  return { client: createORPCClient<V1Client>(link), statuses };
};

describe("/v1's error statuses", () => {
  const declared = new Set(ROWS.flatMap((row) => Object.keys(row.contract["~orpc"].errorMap)));
  const custom = [...declared].filter((code) => !Object.hasOwn(COMMON_ERROR_STATUS_MAP, code));

  it("maps every code a row declares", () => {
    expect([...declared].filter((code) => !Object.hasOwn(V1_ERROR_STATUS_MAP, code))).toEqual([]);
  });

  it("maps exactly the custom codes the rows declare, none of oRPC's own", () => {
    expect(Object.keys(V1_CUSTOM_ERROR_STATUS).toSorted()).toEqual(custom.toSorted());
  });

  it("answers an outage 5xx and every refusal at least 4xx", () => {
    expect(V1_ERROR_STATUS_MAP.SERVICE_UNAVAILABLE).toBeGreaterThanOrEqual(500);
    for (const status of Object.values(V1_CUSTOM_ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  // each custom code thrown by a real handler and read by a real link: the status the handler
  // answers, and the typed refusal the client narrows to with its data
  const os = implement(v1Contract);
  const cases: readonly ErrorCase[] = [
    {
      code: "ACCOUNT_EXISTS",
      data: undefined,
      refusal: async (client) => await refusalOf(client.account.signUp(SIGN_UP)),
      router: {
        account: {
          signUp: os.account.signUp.handler(({ errors }) => {
            throw errors.ACCOUNT_EXISTS();
          }),
        },
      },
    },
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
      code: "ALREADY_UNDONE",
      data: { changeSetId: UUID_V7, undoneBy: UUID_V4 },
      refusal: async (client) =>
        await refusalOf(client.library.history.undo({ changeSetIds: [UUID_V7] })),
      router: {
        library: {
          history: {
            undo: os.library.history.undo.handler(({ errors }) => {
              throw errors.ALREADY_UNDONE({ data: { changeSetId: UUID_V7, undoneBy: UUID_V4 } });
            }),
          },
        },
      },
    },
    {
      code: "BLOB_MISSING",
      data: { shas: [SHA] },
      refusal: async (client) =>
        await refusalOf(
          client.library.write({
            itemId: UUID_V7,
            ops: [{ base: null, field: "coverSha", op: "set", value: SHA }],
          }),
        ),
      router: {
        library: {
          write: os.library.write.handler(({ errors }) => {
            throw errors.BLOB_MISSING({ data: { shas: [SHA] } });
          }),
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
      code: "DEVICE_LIMIT",
      data: undefined,
      refusal: async (client) => await refusalOf(client.account.signIn(SIGN_IN)),
      router: {
        account: {
          signIn: os.account.signIn.handler(({ errors }) => {
            throw errors.DEVICE_LIMIT();
          }),
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
      refusal: async (client) =>
        await refusalOf(
          client.library.items.createFile({
            folderId: null,
            id: UUID_V7,
            name: "report.pdf",
            savedAt: 1_700_000_000_000,
            sha: SHA,
            tags: [],
          }),
        ),
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
    expect(cases.map((sample) => sample.code).toSorted()).toEqual(
      Object.keys(V1_CUSTOM_ERROR_STATUS).toSorted(),
    );
  });

  it.each(cases)("answers $code with its status and its typed data", async (sample) => {
    const { client, statuses } = served(sample.router);
    expect(await sample.refusal(client)).toEqual({ code: sample.code, data: sample.data });
    expect(statuses).toEqual([V1_CUSTOM_ERROR_STATUS[sample.code]]);
  });

  it("carries a conflict's current state back to the writer, typed", async () => {
    const current = { field: "title" as const, itemId: UUID_V7, kind: "field" as const };
    const { client, statuses } = served({
      library: {
        write: os.library.write.handler(({ errors }) => {
          throw errors.CONFLICT({ data: { current: [{ ...current, current: "Theirs" }] } });
        }),
      },
    });
    const { error } = await safe(
      client.library.write({
        itemId: UUID_V7,
        ops: [{ base: "Mine before", field: "title", op: "set", value: "Mine" }],
      }),
    );
    expect(isDefinedError(error) && error.code === "CONFLICT" ? error.data.current : null).toEqual([
      { ...current, current: "Theirs" },
    ]);
    expect(statuses).toEqual([409]);
  });
});

describe("/v1's rows", () => {
  it("takes an optional opId on every library write, so the outbox's resend lands once", () => {
    const writes = rowsOf(v1Contract.library).filter((row) => !LIBRARY_READS.has(row.path));
    expect(writes.length).toBeGreaterThan(0);
    for (const row of writes) {
      const [input] = schemasOf(row.contract["~orpc"].inputSchemas);
      const json = jsonObjectSchema.parse(
        input === undefined ? {} : z.toJSONSchema(input, { io: "input" }),
      );
      expect({ opId: Object.hasOwn(json.properties ?? {}, "opId"), row: row.path }).toEqual({
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
    ).toEqual([]);
  });

  it("names every read it exempts", () => {
    const paths = new Set(rowsOf(v1Contract.library).map((row) => row.path));
    expect([...LIBRARY_READS].filter((path) => !paths.has(path))).toEqual([]);
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
  it("names every kind of row the change log holds", () => {
    expect(libraryChangeSchema.options.map((option) => option.shape.kind.value).toSorted()).toEqual(
      [...LIBRARY_CHANGE_KINDS].toSorted(),
    );
  });

  it("drops a field a newer cell adds to a row, rather than refusing the row", () => {
    const row = {
      card: { outline: [], preview: "", title: "Ada", words: 0 },
      fields: {
        aliases: [],
        author: null,
        copySha: null,
        coverSha: null,
        deletedAt: null,
        description: null,
        fetchError: null,
        fetchState: "none",
        fetchedAt: null,
        folderId: null,
        kind: "note",
        lang: null,
        originalName: null,
        originalSha: null,
        pinnedAt: null,
        properties: {},
        published: null,
        savedAt: 1,
        site: null,
        tags: [],
        title: "Ada",
        url: null,
      },
      id: UUID_V7,
      kind: "live",
      seq: 3,
      updatedAt: 1,
    };
    const parsed = liveItemRowSchema.parse({
      ...row,
      fields: { ...row.fields, rating: 5 },
      later: true,
    });
    expect(parsed).toEqual(row);
  });

  it("holds an item a device creates to a uuid v7, so an offline id sorts by when it was made", () => {
    expect(newIdSchema.safeParse(UUID_V7).success).toBe(true);
    expect(newIdSchema.safeParse(UUID_V4).success).toBe(false);
  });

  it("refuses a highlight that is both a passage and a reply", () => {
    const add = {
      createdAt: 1,
      id: "h1",
      occurrence: null,
      op: "add",
      parentId: null,
      quote: "a passage",
      text: "",
    };
    expect(annotationOpSchema.safeParse(add).success).toBe(true);
    expect(annotationOpSchema.safeParse({ ...add, parentId: "h0" }).success).toBe(false);
    expect(annotationOpSchema.safeParse({ ...add, quote: null }).success).toBe(false);
  });

  it("refuses a title for many items and a write that changes nothing", () => {
    const organize = v1Contract.library.items.organize["~orpc"].inputSchemas;
    const [schema] = schemasOf(organize);
    expect(schema?.safeParse({ ids: [UUID_V7], title: "One" }).success).toBe(true);
    expect(schema?.safeParse({ ids: [UUID_V7, UUID_V4], title: "Both" }).success).toBe(false);
    const [write] = schemasOf(v1Contract.library.write["~orpc"].inputSchemas);
    expect(write?.safeParse({ itemId: UUID_V7, ops: [] }).success).toBe(false);
  });

  it("names a library scope's folder by id", () => {
    const library = {
      itemIds: [UUID_V7],
      scope: { folderId: UUID_V7, kind: "folder" },
      selected: 3,
      surface: "library",
    };
    expect(agentViewContextSchema.safeParse(library).success).toBe(true);
    expect(
      agentViewContextSchema.safeParse({ ...library, scope: { kind: "folder", path: "Reading" } })
        .success,
    ).toBe(false);
  });
});
