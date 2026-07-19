import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeAssetDir, pickAssetPath, sanitizeAssetName } from "../handlers/vault-handlers";
import { VaultManager } from "../vault/vault";

describe("sanitizeAssetName", () => {
  it("strips path separators and traversal to a bare leaf", () => {
    expect(sanitizeAssetName("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeAssetName("a/b/c/pic.png")).toBe("pic.png");
    expect(sanitizeAssetName("C:\\Users\\x\\shot.png")).toBe("shot.png");
  });

  it("drops leading dots and junk chars, keeping word/space/dot/dash", () => {
    expect(sanitizeAssetName(".hidden.png")).toBe("hidden.png");
    expect(sanitizeAssetName("my pic (final)!.png")).toBe("my pic final.png");
  });

  it("falls back to 'image' when nothing survives", () => {
    expect(sanitizeAssetName("")).toBe("image");
    expect(sanitizeAssetName("///")).toBe("image");
    expect(sanitizeAssetName("...")).toBe("image");
  });
});

describe("normalizeAssetDir", () => {
  it("drops traversal/empty segments and defaults to assets", () => {
    expect(normalizeAssetDir("assets")).toBe("assets");
    expect(normalizeAssetDir("/assets/")).toBe("assets");
    expect(normalizeAssetDir("../../x")).toBe("x");
    expect(normalizeAssetDir("")).toBe("assets");
    expect(normalizeAssetDir("a/./b")).toBe("a/b");
  });
});

describe("pickAssetPath", () => {
  it("returns the plain path when there is no collision", () => {
    expect(pickAssetPath("assets", "pic.png", new Set())).toBe("assets/pic.png");
  });

  it("suffixes -1, -2, … before the extension on collisions", () => {
    const existing = new Set(["assets/pic.png", "assets/pic-1.png"]);
    expect(pickAssetPath("assets", "pic.png", existing)).toBe("assets/pic-2.png");
  });

  it("handles extension-less names", () => {
    expect(pickAssetPath("assets", "pic", new Set(["assets/pic"]))).toBe("assets/pic-1");
  });
});

describe("asset bytes round-trip through the vault", () => {
  let tmp: string;
  let mgr: VaultManager;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-asset-test-"));
    mgr = new VaultManager({
      settingsPath: path.join(tmp, "settings.json"),
      defaultRoot: path.join(tmp, "vault"),
      manageAgentLink: false,
    });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("decodes base64 to the exact on-disk bytes and re-encodes losslessly", () => {
    // A byte sequence with high bytes and a NUL — proves it's not a text path.
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 137, 80, 78, 71]);
    const bytesBase64 = Buffer.from(original).toString("base64");

    const existing = new Set(mgr.list().map((entry) => entry.path));
    const target = pickAssetPath(
      normalizeAssetDir("assets"),
      sanitizeAssetName("screenshot.png"),
      existing,
    );
    expect(target).toBe("assets/screenshot.png");

    mgr.writeBytes(target, new Uint8Array(Buffer.from(bytesBase64, "base64")));

    const readBack = mgr.readBytes(target);
    expect([...readBack]).toEqual([...original]);
    expect(Buffer.from(readBack).toString("base64")).toBe(bytesBase64);

    // A second write of the same name now collides and suffixes.
    const next = pickAssetPath(
      normalizeAssetDir("assets"),
      sanitizeAssetName("screenshot.png"),
      new Set(mgr.list().map((entry) => entry.path)),
    );
    expect(next).toBe("assets/screenshot-1.png");
  });
});
