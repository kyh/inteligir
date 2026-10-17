// the items procedures over a booted server: what a save writes before any fill reads the page,
// what a file save and a tag edit write, and how each refuses.

import { readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describe, expect, it } from "vitest";

import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";

const URL_SAVED = "https://stephango.com/file-over-app?utm_source=feed";
const SAVED_LINE = /^saved: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/mu;

const onDisk = (harness: BootedTestApp, path: string): string =>
  readFileSync(nodePath.join(harness.vaultDir, path), "utf-8");

// an item whose page was read, failed when `extra` says so
const readItem = (url: string, extra: string): string =>
  [
    "---",
    "id: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
    "kind: link",
    `url: ${url}`,
    "saved: 2026-10-17T09:12:30Z",
    "fetched: 2026-10-17T09:12:40Z",
    extra,
    "---",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

describe("a saved link before its page is read", () => {
  it("is a stub in Unsorted, named from the address and kept with its url cleaned", async () => {
    const harness = await bootTestApp();
    const saved = await harness.client.items.saveLink({ url: URL_SAVED });
    expect(saved).toEqual({
      fill: { state: "pending" },
      outcome: "created",
      path: "Unsorted/stephango.com - file over app.md",
    });
    const stub = onDisk(harness, saved.path);
    expect(frontmatterId(stub)).not.toBeNull();
    expect(stub).toContain("kind: link\nurl: https://stephango.com/file-over-app\n");
    expect(stub).toMatch(SAVED_LINE);
    expect(stub).not.toContain("fetched");
  });

  it("takes the folder, the title and the tags the request carries", async () => {
    const harness = await bootTestApp();
    const saved = await harness.client.items.saveLink({
      folder: "Reading",
      tags: ["essays"],
      title: "File over app",
      url: URL_SAVED,
    });
    expect(saved.path).toBe("Reading/File over app.md");
    expect(onDisk(harness, saved.path)).toContain("tags:\n  - essays\n");
  });

  it("answers exists for an address the library holds, however the url is spelled", async () => {
    const harness = await bootTestApp();
    const first = await harness.client.items.saveLink({ url: URL_SAVED });
    const again = await harness.client.items.saveLink({
      url: "https://www.stephango.com/file-over-app",
    });
    expect(again).toEqual({ fill: { state: "pending" }, outcome: "exists", path: first.path });
  });

  it("writes one file for two saves of one address at once", async () => {
    const harness = await bootTestApp();
    const [a, b] = await Promise.all([
      harness.client.items.saveLink({ url: URL_SAVED }),
      harness.client.items.saveLink({ url: URL_SAVED }),
    ]);
    expect([a.outcome, b.outcome].toSorted()).toEqual(["created", "exists"]);
    expect(a.path).toBe(b.path);
  });

  it("takes the next free name when the address's name is taken", async () => {
    const harness = await bootTestApp();
    await harness.vault.service.write("Unsorted/stephango.com - file over app.md", "mine\n");
    const saved = await harness.client.items.saveLink({ url: URL_SAVED });
    expect(saved.path).toBe("Unsorted/stephango.com - file over app 2.md");
  });

  it("answers an item's state from its file once indexed: filled, or failed with its sentence", async () => {
    const harness = await bootTestApp();
    await harness.vault.service.write("Filled.md", readItem("https://example.com/filled", ""));
    await harness.vault.service.write(
      "Failed.md",
      readItem("https://example.com/gone", "fetch-error: The site answered 404 (not found)."),
    );
    expect(await harness.client.items.saveLink({ url: "https://example.com/filled" })).toEqual({
      fill: { state: "filled" },
      outcome: "exists",
      path: "Filled.md",
    });
    expect(await harness.client.items.saveLink({ url: "https://example.com/gone" })).toEqual({
      fill: { message: "The site answered 404 (not found).", state: "failed" },
      outcome: "exists",
      path: "Failed.md",
    });
  });

  it("keeps a page's selection as a highlight waiting for the page's text", async () => {
    const harness = await bootTestApp();
    const saved = await harness.client.items.savePage({
      page: {
        html: "<p>Apps are ephemeral.</p>",
        selection: { text: "  Apps   are ephemeral. " },
        title: "File over app",
        url: URL_SAVED,
      },
    });
    expect(saved).toEqual({
      fill: { state: "pending" },
      outcome: "created",
      path: "Unsorted/File over app.md",
    });
    const listed = await harness.client.annotations.list({ path: saved.path });
    expect(listed.annotations.map(({ quote, state }) => ({ quote, state }))).toEqual([
      { quote: "Apps are ephemeral.", state: "waiting" },
    ]);

    const again = await harness.client.items.savePage({
      page: { html: null, selection: { text: "files" }, title: "", url: URL_SAVED },
    });
    expect(again.outcome).toBe("exists");
    const relisted = await harness.client.annotations.list({ path: saved.path });
    // both made within one second, so their order is the ids'
    expect(relisted.annotations.map(({ quote }) => quote).toSorted()).toEqual([
      "Apps are ephemeral.",
      "files",
    ]);
    const id = frontmatterId(onDisk(harness, saved.path));
    expect(id === null ? null : onDisk(harness, annotationsStorePath(id))).toContain('"files"');
  });

  it("refreshes only a saved link, and answers at once without waiting", async () => {
    const harness = await bootTestApp();
    const saved = await harness.client.items.saveLink({ url: URL_SAVED });
    expect(await harness.client.items.refresh({ path: saved.path, wait: false })).toEqual({
      fill: { state: "pending" },
      path: saved.path,
    });
    await harness.vault.service.write("Plain.md", "# Just a note\n");
    const [notLink] = await safe(harness.client.items.refresh({ path: "Plain.md" }));
    expect(isDefinedError(notLink) && notLink.code).toBe("BAD_REQUEST");
    const [missing] = await safe(harness.client.items.refresh({ path: "Nowhere.md" }));
    expect(isDefinedError(missing) && missing.code).toBe("NOT_FOUND");
  });
});

describe("a saved file", () => {
  it("is its original where a paste would land, and a wrapper that embeds it", async () => {
    const harness = await bootTestApp();
    const saved = await harness.client.items.saveFile({
      file: new Blob([new Uint8Array([37, 80, 68, 70])]),
      name: "Annual report.pdf",
      tags: ["work"],
      url: "https://example.com/report.pdf?utm_medium=email",
    });
    expect(saved).toEqual({
      fill: { state: "filled" },
      outcome: "created",
      path: "Unsorted/Annual report.md",
    });
    const wrapper = onDisk(harness, saved.path);
    expect(wrapper).toContain("kind: pdf\nurl: https://example.com/report.pdf\n");
    expect(wrapper).toContain("tags:\n  - work\n");
    expect(wrapper.endsWith("---\n\n![](<assets/Annual report.pdf>)\n")).toBe(true);
    expect(readFileSync(nodePath.join(harness.vaultDir, "assets", "Annual report.pdf"))).toEqual(
      Buffer.from([37, 80, 68, 70]),
    );
  });

  it("refuses a file over the cap, a doc's name, and a folder a file stands in", async () => {
    const harness = await bootTestApp();
    const [tooLarge] = await safe(
      harness.client.items.saveFile({
        file: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
        name: "big.mov",
      }),
    );
    expect(isDefinedError(tooLarge) && tooLarge.code).toBe("PAYLOAD_TOO_LARGE");
    const [aDoc] = await safe(
      harness.client.items.saveFile({ file: new Blob(["# x\n"]), name: "note.md" }),
    );
    expect(isDefinedError(aDoc) && aDoc.code).toBe("INVALID_PATH");
    writeFileSync(nodePath.join(harness.vaultDir, "Inbox"), "a file\n");
    const [intoAFile] = await safe(
      harness.client.items.saveFile({
        file: new Blob(["x"]),
        folder: "Inbox",
        name: "shot.png",
      }),
    );
    expect(isDefinedError(intoAFile) && intoAFile.code).toBe("CONFLICT");
  });
});

describe("tagging items", () => {
  it("edits each item's frontmatter tags and says what happened to each, in request order", async () => {
    const harness = await bootTestApp();
    await harness.vault.service.write("a.md", "---\ntags: [old]\n---\nWritten with #old.\n");
    await harness.vault.service.write("b.md", "---\ntags:\n  - new\n---\n");
    await harness.vault.service.write("bad.md", "---\ntags: [\n---\n");
    const { results } = await harness.client.items.tag({
      add: ["new"],
      paths: ["a.md", "b.md", "gone.md", "bad.md", "shot.png"],
      remove: ["old"],
    });
    expect(results).toEqual([
      { inline: ["old"], outcome: "changed", path: "a.md" },
      { inline: [], outcome: "unchanged", path: "b.md" },
      { inline: [], outcome: "missing", path: "gone.md" },
      { inline: [], outcome: "invalid", path: "bad.md" },
      { inline: [], outcome: "invalid", path: "shot.png" },
    ]);
    expect(onDisk(harness, "a.md")).toBe("---\ntags: [new]\n---\nWritten with #old.\n");
  });
});
