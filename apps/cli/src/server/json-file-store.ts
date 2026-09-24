/* oxlint-disable max-classes-per-file -- the refusal class is the store's contract; the rpc boundary puts its message on the wire */
// The one shape every app-written JSON file in the data dir takes: not config.json, which is
// read once at boot and never written by the app, but a file read per use so a Settings or
// CLI edit reaches the next paste, thread or session without a reboot. Only an absent file is
// the empty value: unreadable or malformed bytes are an ERROR, because an empty value lets the
// next write erase what the bytes held.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { errnoCode } from "./errno";
import { messageOf } from "./error-message";
import { stagedWriteFileSync } from "./staged-write";

export class JsonFileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonFileStoreError";
  }
}

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
    this.path = path.join(args.dataDir, args.fileName);
    this.args = args;
  }

  read(): z.output<TSchema> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf-8");
    } catch (error) {
      if (errnoCode(error) === "ENOENT") {
        // a copy: a caller that edits what it read must not edit what the next absent read answers.
        return structuredClone(this.args.empty);
      }
      throw new JsonFileStoreError(
        `${this.path} could not be read (${errnoCode(error) ?? messageOf(error)}) — refusing to read it as empty`,
      );
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

  // refused before the bytes land: a value the next read would refuse must never reach the disk.
  write(value: z.input<TSchema>): void {
    if (!this.args.schema.safeParse(value).success) {
      throw new JsonFileStoreError(
        `refusing to write ${this.path}: the value does not match the ${this.args.fileName} shape`,
      );
    }
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    if (this.args.mode === undefined) {
      stagedWriteFileSync(this.path, contents);
    } else {
      stagedWriteFileSync(this.path, contents, { mode: this.args.mode });
    }
  }
}
