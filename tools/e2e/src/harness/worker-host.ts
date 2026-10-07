// Boots apps/web's built Worker under Miniflare, as its own process so the harness supervises and
// kills it like any other child. Reads the Build Output `cf build` writes, so the bindings are the
// ones that deploy, never a restatement.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare, MiniflareWorkerConfigBaseSchema } from "miniflare";
import type { MiniflareOptions } from "miniflare";
import { z } from "zod";

const HostArgsSchema = z.object({
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
        // the production routes would leave the local origin unrouted
        triggers: [],
      },
    },
  ];
};

// splitting the DDL on `;` holds only while no string literal in the schema contains one
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
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  } finally {
    await setup.dispose();
  }
};

const workers = await workerOptions();
await applySchema(workers);
const miniflare = new Miniflare({
  host: "127.0.0.1",
  inspectorPort: args.inspectorPort,
  port: args.port,
  resourcePersistencePath: args.stateDir,
  workers,
});
await miniflare.ready;

const stop = async (): Promise<void> => {
  await miniflare.dispose();
  process.exit(0);
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
