import { describe, expect, it } from "vitest";
import { excludedFromBackup } from "../outbox-files";
import type { OutboxFolder } from "../outbox-files";

const FOLDER = "/documents/outbox/";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

// a folder that says what was asked of it, in order
const loggedFolder = (log: string[]): OutboxFolder => {
  const staged = new Map<string, Uint8Array>();
  return {
    clear: async () => {
      log.push("clear");
      staged.clear();
    },
    ensure: async () => {
      log.push("ensure");
      return FOLDER;
    },
    find: async (name) => (staged.has(name) ? `file://${FOLDER}${name}` : null),
    read: async (name) => staged.get(name) ?? new Uint8Array(),
    remove: async (name) => {
      staged.delete(name);
    },
    stage: async (name, bytes) => {
      log.push(`stage ${name}`);
      staged.set(name, bytes);
    },
  };
};

describe("the outbox's staged photos", () => {
  it("sit in a folder flagged out of the backup before each lands, a cleared one included", async () => {
    const log: string[] = [];
    const files = excludedFromBackup(loggedFolder(log), async (directory) => {
      log.push(`exclude ${directory}`);
    });

    await files.stage("a.jpg", PHOTO);
    await files.clear();
    await files.stage("b.jpg", PHOTO);

    expect(log).toStrictEqual([
      "ensure",
      `exclude ${FOLDER}`,
      "stage a.jpg",
      "clear",
      "ensure",
      `exclude ${FOLDER}`,
      "stage b.jpg",
    ]);
    expect(await files.find("b.jpg")).toBe(`file://${FOLDER}b.jpg`);
  });

  it("stages nothing when the folder cannot be kept out", async () => {
    const log: string[] = [];
    const files = excludedFromBackup(loggedFolder(log), async () => {
      throw new Error("no such directory");
    });

    await expect(files.stage("a.jpg", PHOTO)).rejects.toThrow("no such directory");
    expect(log).toStrictEqual(["ensure"]);
  });
});
