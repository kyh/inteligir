// the agent's verbs on the command line against the real composition: a Raindrop import into the
// library, the listing, an item's facts, finding a link, tagging, highlighting a passage and
// taking it back out, and Tidy my library through the scripted driver. Every fetch is the booted
// app's own, which never answers, so an imported link stays a stub and nothing leaves the machine.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { annotationsResponseSchema } from "@repo/contract/local/annotations/annotations-schema";
import {
  importsJobResponseSchema,
  importsPlanResponseSchema,
} from "@repo/contract/local/imports/imports-schema";
import { knowledgeItemsResponseSchema } from "@repo/contract/local/knowledge/knowledge-schema";

import { itemShowOutputSchema } from "../commands/item";
import { tagChangeOutputSchema } from "../commands/tag";
import { resolveAgentDriver } from "../server/agents/agent-driver";
import { fakeSessionFacts } from "../server/agents/__tests__/agent-test-harness";
import { bootTestApp, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import type { BootTestAppOptions } from "../server/__tests__/boot-app";
import { loopbackOrigin } from "../server/server-file";
import { runCliForTest } from "./run-cli";
import type { CliRunResult } from "./run-cli";

const RAINDROP = path.resolve(
  import.meta.dirname,
  "../server/imports/__tests__/fixtures/raindrop-export.csv",
);
const PLAN_SENTENCE =
  "6 links in 4 folders, with 6 tags and 4 highlights. Each page's text and picture fill in over the next while.";

// the scripted driver, as `INTELIGIR_AGENT=scripted` runs it, in a session that holds the CLI
const SCRIPTED: BootTestAppOptions = {
  agent: { mode: "scripted" },
  makeDriver: ({ db, bus, items, vault, vaultDir, sink }) => ({
    driver: resolveAgentDriver({
      config: { agent: "scripted", agentModels: { claude: null, codex: null }, vaultDir },
      db,
      defaultHarness: () => "claude",
      items,
      notifier: bus,
      sessionFacts: () => fakeSessionFacts({ cliBinDir: "/app/bin" }),
      sink,
      vault,
    }).driver,
  }),
};

const bootCli = async (options: BootTestAppOptions = {}) => {
  const booted = await bootTestApp(options);
  const { port } = await listenTestApp(booted);
  const baseUrl = loopbackOrigin(port);
  const cli = async (argv: string[]): Promise<CliRunResult> =>
    await runCliForTest({ argv, baseUrl, token: TEST_SERVER_TOKEN });
  const linesOf = async (argv: string[]): Promise<string[]> => {
    const run = await cli(argv);
    return run.stdout.split("\n").filter((line) => line !== "");
  };
  const jsonOf = async <T>(schema: z.ZodType<T>, argv: string[]): Promise<T> => {
    const run = await cli([...argv, "--json"]);
    return schema.parse(JSON.parse(run.stdout));
  };
  const onDisk = (vaultPath: string): string => {
    const absolute = path.join(booted.vaultDir, vaultPath);
    return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
  };
  const write = (vaultPath: string, content: string): void => {
    writeFileSync(path.join(booted.vaultDir, vaultPath), content);
  };
  return { cli, jsonOf, linesOf, onDisk, write };
};

describe("importing a Raindrop export", { timeout: 120_000 }, () => {
  it("plans, imports into folders with tags, pins and waiting highlights, and adds nothing twice", async () => {
    const { cli, jsonOf, linesOf } = await bootCli();

    expect(await linesOf(["import", "raindrop", RAINDROP, "--dry-run"])).toEqual([PLAN_SENTENCE]);
    expect(
      await jsonOf(importsPlanResponseSchema, ["import", "raindrop", RAINDROP, "--dry-run"]),
    ).toMatchObject({ alreadySaved: 0, duplicates: 1, items: 6, skippedCount: 3 });

    expect(await linesOf(["import", "raindrop", RAINDROP])).toEqual([
      PLAN_SENTENCE,
      "Imported 6 items from Raindrop",
    ]);

    const reading = await jsonOf(knowledgeItemsResponseSchema, [
      "items",
      "--folder",
      "Reading",
      "--flat",
    ]);
    expect(reading.items.map((item) => item.path).toSorted()).toEqual([
      "Reading/Commas, 'quotes' and lines.md",
      "Reading/File over app.md",
    ]);
    const { item } = await jsonOf(itemShowOutputSchema, [
      "item",
      "show",
      "Reading/File over app.md",
    ]);
    expect(item).toMatchObject({
      kind: "link",
      pending: true,
      pinned: true,
      saved: "2023-07-01T09:12:30Z",
      tags: ["philosophy", "files", "ideas", "c"],
      url: "https://stephango.com/file-over-app",
    });
    expect(await linesOf(["item", "show", "Reading/File over app.md"])).toEqual([
      "kind: link",
      "url: https://stephango.com/file-over-app",
      "saved: 2023-07-01T09:12:30Z",
      "folder: Reading",
      "tags: #philosophy #files #ideas #c",
      "pinned: yes",
    ]);

    const highlights = await jsonOf(annotationsResponseSchema, [
      "annotation",
      "list",
      "Reading/File over app.md",
    ]);
    // one row's highlights share its saved time, so until the fill places them they list by id
    expect(highlights.annotations.map(({ state }) => state)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(highlights.annotations.map(({ quote }) => quote).toSorted()).toEqual([
      "A third one.",
      "Apps are ephemeral, but files are not.",
      "Files last.",
    ]);

    const again = await jsonOf(importsJobResponseSchema, ["import", "raindrop", RAINDROP]);
    expect(again.job).toMatchObject({ added: 0, alreadySaved: 6, state: "done" });
    expect(await linesOf(["import", "status"])).toEqual([
      "Imported 0 items from Raindrop (6 already saved)",
    ]);
    const cancelled = await cli(["import", "cancel"]);
    expect(cancelled.stdout).toContain("No import is running");
  });

  it("lists by kind, tag and folder, finds a link however it is spelled, and tags an item", async () => {
    const { jsonOf, linesOf } = await bootCli();
    await jsonOf(importsJobResponseSchema, ["import", "raindrop", RAINDROP]);

    const unsorted = await linesOf(["items", "--folder", "Unsorted", "--sort", "title"]);
    expect(unsorted.map((line) => line.split("\t")[0])).toEqual([
      "Unsorted/example.com - untitled.md",
      "Unsorted/Unsorted one.md",
    ]);
    expect(await linesOf(["items", "--tag", "recipes"])).toEqual([
      "Cooking/Weeknight/Pasta al limone.md\tlink\t2023-10-01\tcooking.example.com\t#recipes #Quick-Meals",
    ]);
    expect(await linesOf(["items", "--kind", "video"])).toEqual(["ℹ No items."]);

    expect(
      await linesOf(["item", "find", "https://www.stephango.com/file-over-app?utm_medium=x"]),
    ).toEqual(["Reading/File over app.md"]);
    expect(await linesOf(["item", "find", "https://nowhere.example/"])).toEqual([
      "ℹ Not saved yet",
    ]);

    expect(await linesOf(["tag", "add", "reading-list", "Reading/File over app.md"])).toEqual([
      "Tagged Reading/File over app.md #reading-list",
    ]);
    expect(
      await jsonOf(tagChangeOutputSchema, [
        "tag",
        "add",
        "reading-list",
        "Reading/File over app.md",
      ]),
    ).toEqual({ inline: [], outcome: "unchanged", path: "Reading/File over app.md" });
    expect(await linesOf(["tag", "remove", "reading-list", "Reading/File over app.md"])).toEqual([
      "Removed #reading-list from Reading/File over app.md",
    ]);
    const untagged = await linesOf(["items", "--untagged", "--folder", "Reading", "--flat"]);
    expect(untagged.map((line) => line.split("\t")[0])).toEqual([
      "Reading/Commas, 'quotes' and lines.md",
    ]);
  });
});

describe("highlighting a passage on the command line", { timeout: 60_000 }, () => {
  it("writes the markers around the passage, lists it, and takes them out again on removal", async () => {
    const { cli, jsonOf, linesOf, onDisk, write } = await bootCli();
    write("Essay.md", "File over app is a philosophy. Files last; apps do not.\n");

    const added = await jsonOf(annotationsResponseSchema, [
      "annotation",
      "add",
      "Essay.md",
      "a philosophy",
      "--note",
      "Worth it",
    ]);
    const [annotation] = added.annotations;
    const id = annotation?.id ?? "";
    expect(annotation).toMatchObject({ passage: "a philosophy", state: "anchored" });
    expect(onDisk("Essay.md")).toContain(`is %%i:${id}:start%%a philosophy%%i:${id}:end%%.`);

    expect(await linesOf(["annotation", "reply", "Essay.md", id, "Agreed"])).toEqual([
      `Replied to ${id}`,
    ]);
    expect(await linesOf(["annotation", "edit", "Essay.md", id, "Worth a read"])).toEqual([
      `Updated ${id}`,
    ]);
    const [root, reply] = await linesOf(["annotation", "list", "Essay.md"]);
    expect(root).toBe(`${id}\tanchored\t"a philosophy"\tWorth a read`);
    expect(reply).toMatch(/^ {2}↳ \S+\tAgreed$/u);

    await jsonOf(annotationsResponseSchema, ["annotation", "add", "Essay.md", "Files last"]);
    expect(await linesOf(["annotation", "remove", "Essay.md", id])).toEqual([
      `Removed highlight ${id}`,
    ]);
    expect(onDisk("Essay.md")).not.toContain(id);
    expect(onDisk("Essay.md")).toContain("is a philosophy. %%i:");

    const absent = await cli(["annotation", "add", "Essay.md", "not in it", "--json"]);
    expect(absent.code).toBe(1);
    expect(JSON.parse(absent.stderr)).toEqual({
      error: "BAD_REQUEST",
      message: "That passage isn't in the item's text.",
    });
  });
});

describe("placing a highlight by its quote on the command line", { timeout: 60_000 }, () => {
  it("marks the occurrence it is asked for in the file, and says where in plain text", async () => {
    const { cli, linesOf, onDisk, write } = await bootCli();
    write("Twice.md", "Files last. Apps fade.\n\nThe second time: Files last.\n");

    const [said] = await linesOf([
      "annotation",
      "add",
      "Twice.md",
      "Files last",
      "--occurrence",
      "2",
      "--note",
      "Said twice",
    ]);
    const id = /^Highlighted "Files last" in Twice\.md \((?<id>[^)]+)\)$/u.exec(said ?? "")?.groups
      ?.id;
    expect(id, `the plain answer: ${String(said)}`).toBeDefined();
    const text = onDisk("Twice.md");
    // the first occurrence stays plain; the second carries the markers, the passage between them
    expect(text).toContain("\nFiles last. Apps fade.\n");
    expect(text).toContain(
      `The second time: %%i:${String(id)}:start%%Files last%%i:${String(id)}:end%%.\n`,
    );
    expect(await linesOf(["annotation", "list", "Twice.md"])).toEqual([
      `${String(id)}\tanchored\t"Files last"\tSaid twice`,
    ]);

    // a third occurrence is not in the text: refused, and the file is as it was
    const third = await cli([
      "annotation",
      "add",
      "Twice.md",
      "Files last",
      "--occurrence",
      "3",
      "--json",
    ]);
    expect(third.code).toBe(1);
    expect(onDisk("Twice.md")).toBe(text);
  });
});

describe("Tidy my library on the command line", { timeout: 60_000 }, () => {
  it("stores the preset's label as the text, and the turn's prompt carries its procedure", async () => {
    const { cli, jsonOf } = await bootCli(SCRIPTED);
    const started = await jsonOf(z.object({ thread: z.object({ id: z.string() }) }), [
      "action",
      "new",
      "--preset",
      "tidy-library",
    ]);
    const threadId = started.thread.id;
    const waited = await cli(["action", "wait", threadId]);
    expect(waited.code).toBe(0);
    const shown = await cli(["action", "show", threadId]);
    expect(shown.stdout).toContain("Tidy my library");
    expect(shown.stdout).toContain(
      "Tidy the person's library: file and tag the items in Unsorted/ and the items with no tags.",
    );
    expect(shown.stdout).toContain("`inteligir items --folder Unsorted --limit 100 --json`");

    const refused = await cli(["action", "new", "--json"]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });
});
