/* oxlint-disable max-classes-per-file -- the refusal class is the store's contract; the rpc boundary puts its message on the wire */
// readJsonFile is the one read of every app-written JSON file in the data dir, and each caller
// says what absent, unreadable and malformed bytes mean to it. JsonFileStore is the file read per
// use, so a Settings or CLI edit reaches the next paste, thread or session without a reboot. In it
// only an absent file is the empty value: unreadable or malformed bytes are an ERROR, because an
// empty value lets the next write erase what the bytes held.

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

export type JsonFileRead<TValue> =
  | { kind: "absent" }
  | { kind: "unreadable"; code: string | undefined; error: unknown }
  | { kind: "malformed"; issue: "json" }
  | { kind: "malformed"; issue: "schema"; error: z.ZodError }
  | { kind: "ok"; value: TValue };

export const readJsonFile = <TSchema extends z.ZodType>(
  filePath: string,
  schema: TSchema,
): JsonFileRead<z.output<TSchema>> => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    const code = errnoCode(error);
    return code === "ENOENT" ? { kind: "absent" } : { code, error, kind: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { issue: "json", kind: "malformed" };
  }
  const verdict = schema.safeParse(parsed);
  return verdict.success
    ? { kind: "ok", value: verdict.data }
    : { error: verdict.error, issue: "schema", kind: "malformed" };
};

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
    const read = readJsonFile(this.path, this.args.schema);
    switch (read.kind) {
      case "ok": {
        return read.value;
      }
      case "absent": {
        // a copy: a caller that edits what it read must not edit what the next absent read answers.
        return structuredClone(this.args.empty);
      }
      case "unreadable": {
        throw new JsonFileStoreError(
          `${this.path} could not be read (${read.code ?? messageOf(read.error)}) — refusing to read it as empty`,
        );
      }
      case "malformed": {
        throw new JsonFileStoreError(
          read.issue === "json"
            ? `${this.path} is not valid JSON — fix or remove the file; refusing to read it as empty`
            : `${this.path} does not match the ${this.args.fileName} shape — fix or remove the file; refusing to read it as empty`,
        );
      }
      // no default
    }
  }

  // refused before the bytes land: a value the next read would refuse must never reach the disk.
  write(value: z.input<TSchema>): void {
    if (!this.args.schema.safeParse(value).success) {
      throw new JsonFileStoreError(
        `refusing to write ${this.path}: the value does not match the ${this.args.fileName} shape`,
      );
    }
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    stagedWriteFileSync(this.path, contents, { mode: this.args.mode });
  }
}
