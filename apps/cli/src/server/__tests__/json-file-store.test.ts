import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonFileStore, JsonFileStoreError } from "../json-file-store";
import { makeTempDir } from "./temp-dir";

const FILE_NAME = "things.json";

const thingsStore = (dataDir: string) =>
  new JsonFileStore({
    dataDir,
    empty: { things: [] },
    fileName: FILE_NAME,
    schema: z.object({ things: z.array(z.string()) }).strict(),
  });

describe("a data-dir JSON store", () => {
  it("reads an absent file as its empty value, and a write back", () => {
    const store = thingsStore(makeTempDir("json-file-store-"));
    expect(store.read()).toEqual({ things: [] });
    store.write({ things: ["a"] });
    expect(store.read()).toEqual({ things: ["a"] });
  });

  it("hands out a copy of the empty value, so an edit to one read is not the next", () => {
    const store = thingsStore(makeTempDir("json-file-store-"));
    store.read().things.push("leaked");
    expect(store.read()).toEqual({ things: [] });
  });

  it("refuses a path it cannot read rather than reading it as empty", () => {
    const dataDir = makeTempDir("json-file-store-");
    mkdirSync(path.join(dataDir, FILE_NAME));
    expect(() => thingsStore(dataDir).read()).toThrow(JsonFileStoreError);
    expect(() => thingsStore(dataDir).read()).toThrow(/EISDIR/u);
  });

  it("refuses malformed bytes and a wrong shape by the file's name", () => {
    const dataDir = makeTempDir("json-file-store-");
    const filePath = path.join(dataDir, FILE_NAME);

    writeFileSync(filePath, "{");
    expect(() => thingsStore(dataDir).read()).toThrow(JsonFileStoreError);
    expect(() => thingsStore(dataDir).read()).toThrow(filePath);

    writeFileSync(filePath, JSON.stringify({ things: [1] }));
    expect(() => thingsStore(dataDir).read()).toThrow(JsonFileStoreError);
  });

  it("refuses to write a value its own read would refuse", () => {
    const dataDir = makeTempDir("json-file-store-");
    const store = new JsonFileStore({
      dataDir,
      empty: {},
      fileName: FILE_NAME,
      schema: z.object({ port: z.number().int().min(1).optional() }).strict(),
    });
    expect(() => {
      store.write({ port: 0 });
    }).toThrow(JsonFileStoreError);
    expect(existsSync(path.join(dataDir, FILE_NAME))).toBe(false);
  });
});
