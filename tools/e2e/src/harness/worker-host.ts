// Boots apps/web's built Worker under Miniflare, as its own process so the harness supervises and
// kills it like any other child. Reads the Build Output `cf build` writes, so the bindings and the
// queues it consumes are the ones that deploy, never a restatement. A second port answers what an account still holds (its
// library cell, its files in R2 and its rows in D1), read through Miniflare's own handles, so a
// scenario observes a deletion the Worker itself would never describe.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Miniflare, MiniflareWorkerConfigBaseSchema } from "miniflare";
import type { MiniflareOptions } from "miniflare";
import { z } from "zod";

const HostArgsSchema = z.object({
  inspectPort: z.number().int(),
  inspectorPort: z.number().int(),
  outputDir: z.string(),
  port: z.number().int(),
  schemaFile: z.string(),
  stateDir: z.string(),
  vars: z.record(z.string(), z.string()),
});

const ManifestSchema = z.object({
  mainModule: z.string(),
  modules: z.record(
    z.string(),
    z.object({ type: z.enum(["cjs", "data", "esm", "json", "sourcemap", "text", "wasm"]) }),
  ),
});

interface TextBinding {
  type: "text";
  value: string;
}

const textBinding = (value: string): TextBinding => ({ type: "text", value });

const args = HostArgsSchema.parse(JSON.parse(process.argv[2] ?? "null"));

const workerOptions = async (): Promise<MiniflareOptions["workers"]> => {
  const raw: unknown = JSON.parse(
    await readFile(path.join(args.outputDir, "worker.config.json"), "utf-8"),
  );
  const { manifest, ...rest } = z.looseObject({ manifest: ManifestSchema }).parse(raw);
  const config = MiniflareWorkerConfigBaseSchema.parse(rest);
  const modules = Object.fromEntries(
    await Promise.all(
      Object.entries(manifest.modules).map(async ([name, { type }]) => [
        name,
        { contents: await readFile(path.join(args.outputDir, "bundle", name), "utf-8"), type },
      ]),
    ),
  );
  const vars = Object.fromEntries(
    Object.entries(args.vars).map(([name, value]) => [name, textBinding(value)]),
  );
  return [
    {
      config: {
        ...config,
        assets: { directory: path.join(args.outputDir, "assets"), hasUserWorker: true },
        env: { ...config.env, ...vars },
        manifest: { mainModule: manifest.mainModule, modules },
        // the production routes would leave the local origin unrouted; the fill queues' consumers
        // stay, so a link saved here is read by the Worker's own consumer, as it is deployed
        triggers: (config.triggers ?? []).filter((trigger) => trigger.type === "queue"),
      },
    },
  ];
};

// one batch: D1 runs it as one transaction and pays the request overhead once. Splitting the DDL on
// `;` holds only while no string literal in the schema contains one
const applySchema = async (workers: MiniflareOptions["workers"]): Promise<void> => {
  // its own instance on no fixed port, so nothing reaches the Worker before its tables exist
  const setup = new Miniflare({ resourcePersistencePath: args.stateDir, workers });
  try {
    const db = await setup.getD1Database("DB");
    const ddl = await readFile(args.schemaFile, "utf-8");
    const statements = ddl
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  } finally {
    await setup.dispose();
  }
};

const workers = await workerOptions();
// the Worker's own name, which addresses its Durable Objects
const scriptName = z.object({ config: z.object({ name: z.string() }) }).parse(workers?.[0])
  .config.name;
await applySchema(workers);
const miniflare = new Miniflare({
  host: "127.0.0.1",
  inspectorPort: args.inspectorPort,
  port: args.port,
  resourcePersistencePath: args.stateDir,
  // what lets the host read a library cell's own SQLite (`holdings` below)
  unsafeInspectDurableObjects: true,
  workers,
});
await miniflare.ready;

const countSchema = z.object({ n: z.number().int() });
const cellSchema = z.object({ deleted: z.number().nullable(), items: z.number().int() });

// Miniflare types its R2 handle through workers-types, which this harness does not install, so the
// bucket is read off the bindings and held to the one call made of it
const listingSchema = z.object({ objects: z.array(z.object({ key: z.string() })) });
const bucketSchema = z.object({
  list: z.function({
    input: [z.object({ prefix: z.string() })],
    output: z.promise(listingSchema),
  }),
});

const filesUnder = async (prefix: string): Promise<number> => {
  const bindings = await miniflare.getBindings();
  const listing = await bucketSchema.parse(bindings["BLOBS"]).list({ prefix });
  return listing.objects.length;
};

// what the account still holds: its cell's items and tombstone, its files, and its rows in D1. A
// cell nobody opened is started empty by the read, as the Worker's next call would start it
const holdings = async (accountId: string) => {
  const db = await miniflare.getD1Database("DB");
  const count = async (sql: string): Promise<number> => {
    const row = await db.prepare(sql).bind(accountId).first();
    return countSchema.parse(row).n;
  };
  const cell = await miniflare.unsafeGetDurableObjectStorage(scriptName, "LibraryDO", {
    name: `library:${accountId}`,
  });
  const [state] = await cell.exec(
    "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT v FROM meta WHERE k = 'deleted_at') AS deleted",
  );
  const files = await filesUnder(`acct/${accountId}/`);
  return {
    cell: cellSchema.parse(state),
    files,
    rows: {
      devices: await count("SELECT COUNT(*) AS n FROM device WHERE user_id = ?"),
      sessions: await count("SELECT COUNT(*) AS n FROM session WHERE user_id = ?"),
      users: await count("SELECT COUNT(*) AS n FROM user WHERE id = ?"),
    },
  };
};

const accountIdOf = async (email: string): Promise<string | null> => {
  const db = await miniflare.getD1Database("DB");
  const row = await db.prepare("SELECT id FROM user WHERE email = ?").bind(email).first();
  return row === null ? null : z.object({ id: z.string() }).parse(row).id;
};

// `/account?email=` answers the account's id, and `/account/<id>` what it holds
const answerFor = async (url: URL): Promise<object | null> => {
  const id = /^\/account\/(?<id>[^/]+)$/u.exec(url.pathname)?.groups?.["id"];
  if (id !== undefined) {
    return await holdings(id);
  }
  const email = url.pathname === "/account" ? url.searchParams.get("email") : null;
  return email === null ? null : { accountId: await accountIdOf(email) };
};

const inspection = createServer(async (request, response) => {
  try {
    const body = await answerFor(new URL(request.url ?? "/", "http://127.0.0.1"));
    response.writeHead(body === null ? 404 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(error instanceof Error ? error.message : "the read failed");
  }
});
inspection.listen(args.inspectPort, "127.0.0.1");

const stop = async (): Promise<void> => {
  inspection.close();
  await miniflare.dispose();
  process.exit(0);
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
