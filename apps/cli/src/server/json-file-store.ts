// The one shape every app-written JSON file in the data dir takes: not config.json, which is
// read once at boot and never written by the app, but a file read per use so a Settings or
// CLI edit reaches the next paste, thread or session without a reboot. Malformed bytes are an
// ERROR, never the empty value: an empty value lets the next write erase what the bytes held.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { stagedWriteFileSync } from "./staged-write";

export class JsonFileStoreError extends Error {}

export interface JsonFileStoreArgs<TSchema extends z.ZodType> {
  dataDir: string;
  fileName: string;
  schema: TSchema;
  // what an absent file reads as
  empty: z.output<TSchema>;
  // 0o600 for a file that holds a secret
  mode?: number;
}

export class JsonFileStore<TSchema extends z.ZodType> {
  private readonly path: string;
  private readonly args: JsonFileStoreArgs<TSchema>;

  constructor(args: JsonFileStoreArgs<TSchema>) {
    this.path = join(args.dataDir, args.fileName);
    this.args = args;
  }

  read(): z.output<TSchema> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return this.args.empty;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new JsonFileStoreError(
        `${this.path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
      );
    }
    const verdict = this.args.schema.safeParse(parsed);
    if (!verdict.success) {
      throw new JsonFileStoreError(
        `${this.path} does not match the ${this.args.fileName} shape — fix or remove the file; refusing to read it as empty`,
      );
    }
    return verdict.data;
  }

  write(value: z.input<TSchema>): void {
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    if (this.args.mode === undefined) {
      stagedWriteFileSync(this.path, contents);
    } else {
      stagedWriteFileSync(this.path, contents, { mode: this.args.mode });
    }
  }
}
