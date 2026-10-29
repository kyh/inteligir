import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { itemSaveResponseSchema } from "@repo/contract/local/items/items-schema";
import type { ItemSaveResponse } from "@repo/contract/local/items/items-schema";
import { resolveCliBinDir, toShellEnv } from "inteligir/server/agent-shell-env";
import { z } from "zod";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { startLanFixture } from "../harness/lan-fixture";
import type { LanFixture, LanRoute } from "../harness/lan-fixture";
import { pollUntil } from "../harness/poll";
import { solidPng } from "../harness/png-pixels";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const TITLE = "Keeping notes in plain files";
const ITEM_PATH = `Unsorted/${TITLE}.md`;
const COVER = solidPng(640, 400, [40, 90, 160, 255]);

const ARTICLE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  '<meta property="og:site_name" content="The LAN Journal">',
  '<meta name="description" content="Why a folder of text files outlasts every app that reads it.">',
  '<meta name="author" content="Ada Example">',
  '<meta property="og:image" content="/cover.png">',
  "</head><body>",
  '<nav><a href="/">Home</a> <a href="/about">About</a></nav>',
  "<article>",
  `<h1>${TITLE}</h1>`,
  "<p>A folder of text files outlasts every app that reads it. The files are yours, on your own disk, in a format any program can open.</p>",
  "<h2>What lasts</h2>",
  "<p>Plain text has been readable for fifty years, and nothing suggests that will change soon.</p>",
  '<p>Read more in <a href="/notes/formats">the note on formats</a>, or <em>keep</em> writing.</p>',
  "</article>",
  "<footer>Written on a quiet afternoon.</footer>",
  "</body></html>",
].join("\n");

// the editor's own spelling of the article, under the cover: what an item opens rich from
const articleBody = (lan: LanFixture, cover: string): string =>
  [
    `![](${cover})`,
    "",
    "A folder of text files outlasts every app that reads it. The files are yours, on your own disk, in a format any program can open.",
    "",
    "## What lasts",
    "",
    "Plain text has been readable for fifty years, and nothing suggests that will change soon.",
    "",
    `Read more in [the note on formats](${lan.url("/notes/formats")}), or _keep_ writing.`,
    "",
  ].join("\n");

const pageOf = (title: string, text: string, head = ""): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body><article><h1>${title}</h1><p>${text}</p></article></body></html>`;

const ROUTES = {
  "/cover.png": { body: COVER, type: "image/png" },
  "/essay": { body: ARTICLE },
  "/first": { body: pageOf("The first of two", "The first page saved from the list on stdin.") },
  "/second": { body: pageOf("The second of two", "The second page saved from the list on stdin.") },
  "/slow": { body: pageOf("A page read after a restart", "Its fill was cut by a kill.") },
  "/style.css": { body: "body { color: rgb(1, 2, 3); }", type: "text/css; charset=utf-8" },
  "/styled": {
    body: pageOf(
      "A page worth keeping",
      "The copy keeps how this page looked.",
      '<link rel="stylesheet" href="/style.css"><script>document.title = "ran";</script>',
    ),
  },
  "/to-metadata": { redirect: "http://169.254.169.254/latest/meta-data/" },
} satisfies Record<string, LanRoute>;

// what a refused fetch says in the file, by the space its address is in
const ON_THIS_MAC = "This address is on this Mac, so its page isn't read.";
const ON_THE_HARDWARE = "This address is on this network's own hardware, so its page isn't read.";

const saveStdinSchema = z.object({ results: z.array(itemSaveResponseSchema) });

const saveJson = async (cli: AgentShellCli, ...argv: string[]): Promise<ItemSaveResponse> => {
  const { stdout } = await cli("save", ...argv, "--json");
  return itemSaveResponseSchema.parse(JSON.parse(stdout));
};

const onDisk = async (app: AppInstance, vaultPath: string): Promise<string | null> => {
  const absolute = path.join(app.vaultDir, vaultPath);
  return existsSync(absolute) ? await readFile(absolute, "utf-8") : null;
};

const bodyOf = (content: string): string => content.split("\n---\n").slice(1).join("\n---\n");

const failedWith = (saved: ItemSaveResponse, message: string, label: string): void => {
  expectEq(saved.fill, { message, state: "failed" }, `${label}: the save's fill`);
};

// `save -` as an agent's bash pipes it: printf into the bare name on the agent's PATH
const pipeLinks = async (ctx: ScenarioContext, app: AppInstance, urls: readonly string[]) => {
  const cliBinDir = resolveCliBinDir(path.join(ctx.repoRoot, "apps", "cli", "bin"));
  expect(cliBinDir !== null, "the app resolves a CLI bin directory for the agent's PATH");
  const env = {
    ...hermeticProcessEnv(),
    ...toShellEnv({ cliBinDir, dataDir: app.dataDir, skillsDir: null }, hermeticProcessEnv()),
  };
  const { stdout } = await exec(
    "sh",
    ["-c", String.raw`printf '%s\n' "$@" | inteligir save - --json`, "sh", ...urls],
    { env, timeoutMs: 120_000 },
  );
  return saveStdinSchema.parse(JSON.parse(stdout)).results;
};

// a page server on this Mac's own loopback, which the save must never reach
const loopbackRefused = async (ctx: ScenarioContext, cli: AgentShellCli, app: AppInstance) => {
  let reached = 0;
  const listener = createServer((_request, response) => {
    reached += 1;
    response.end("<title>never read</title>");
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = z.object({ port: z.number() }).parse(listener.address());
  try {
    ctx.log("a page on this Mac's own loopback is never fetched, and the item says why");
    const saved = await saveJson(cli, `http://127.0.0.1:${String(address.port)}/`);
    expectEq(saved.outcome, "created", "the loopback save's outcome");
    failedWith(saved, ON_THIS_MAC, "the loopback save");
    const content = (await onDisk(app, saved.path)) ?? "";
    expect(
      content.includes(`fetch-error: ${ON_THIS_MAC}\n`),
      `the loopback item says why in its file:\n${content}`,
    );
    expectEq(reached, 0, "requests that reached the loopback listener");
  } finally {
    listener.close();
  }
};

const articleFills = async (
  ctx: ScenarioContext,
  cli: AgentShellCli,
  app: AppInstance,
  lan: LanFixture,
) => {
  ctx.log(
    "a page on this machine's network address fills: its facts, its cover, its text and its title",
  );
  const url = lan.url("/essay");
  const saved = await saveJson(cli, url);
  expectEq(saved.fill, { state: "filled" }, "the article's fill");
  expectEq(saved.path, ITEM_PATH, "the item's name, from the page's title");
  const content = (await onDisk(app, saved.path)) ?? "";
  for (const line of [
    "kind: link",
    `url: ${url}`,
    "site: The LAN Journal",
    "author: Ada Example",
    "description: Why a folder of text files outlasts every app that reads it.",
  ]) {
    expect(content.includes(`\n${line}\n`), `the item's frontmatter holds "${line}":\n${content}`);
  }
  expect(/\nsaved: \S+\n/u.test(content), `the item holds when it was saved:\n${content}`);
  expect(/\nfetched: \S+\n/u.test(content), `the item holds when it was read:\n${content}`);
  const cover = /^!\[\]\((?<cover>assets\/covers\/[0-9a-f]{16}\.png)\)$/mu.exec(content)?.groups
    ?.cover;
  expect(cover !== undefined, `the item's first embed is its cover:\n${content}`);
  expectEq(bodyOf(content), `\n${articleBody(lan, cover)}`, "the item's body");
  const coverBytes = await readFile(path.join(app.vaultDir, cover));
  expectEq(
    Buffer.compare(coverBytes, Buffer.from(COVER)),
    0,
    "the cover's bytes against the page's",
  );

  ctx.log("a save of the same link answers the item it already is");
  const again = await saveJson(cli, `${url}?utm_source=feed`);
  expectEq([again.outcome, again.path], ["exists", ITEM_PATH], "the resave");
};

const refusalsAndErrors = async (
  ctx: ScenarioContext,
  cli: AgentShellCli,
  app: AppInstance,
  lan: LanFixture,
) => {
  ctx.log("a redirect to the cloud metadata address and a missing page keep their items with why");
  const redirected = await saveJson(cli, lan.url("/to-metadata"));
  failedWith(redirected, ON_THE_HARDWARE, "the redirect to 169.254.169.254");
  const missing = await saveJson(cli, lan.url("/missing"));
  failedWith(missing, "The site answered 404 (not found).", "the missing page");
  const content = (await onDisk(app, missing.path)) ?? "";
  expect(
    content.includes("fetch-error: The site answered 404 (not found).\n"),
    `the missing page's item says why:\n${content}`,
  );
};

const copyKept = async (
  ctx: ScenarioContext,
  cli: AgentShellCli,
  app: AppInstance,
  lan: LanFixture,
) => {
  ctx.log("--copy keeps one script-free copy of the page beside the item, linked from it");
  const saved = await saveJson(cli, lan.url("/styled"), "--copy");
  expectEq(saved.fill, { state: "filled" }, "the copied page's fill");
  const content = (await onDisk(app, saved.path)) ?? "";
  const copy = /\[Copy of the page\]\((?<copy>assets\/pages\/[0-9a-f]{16}\.html)\)/u.exec(content)
    ?.groups?.copy;
  expect(copy !== undefined, `the item links its copy:\n${content}`);
  const kept = (await onDisk(app, copy)) ?? "";
  expect(kept.includes("rgb(1, 2, 3)"), "the copy holds the page's stylesheet");
  expect(!kept.includes("<script"), "the copy holds no script");
};

const stdinInOrder = async (ctx: ScenarioContext, app: AppInstance, lan: LanFixture) => {
  ctx.log("save - saves every link on stdin, in order");
  const results = await pipeLinks(ctx, app, [lan.url("/first"), lan.url("/second")]);
  expectEq(
    results.map((result) => [result.outcome, result.path]),
    [
      ["created", "Unsorted/The first of two.md"],
      ["created", "Unsorted/The second of two.md"],
    ],
    "save -'s answers",
  );
};

const killedMidFill = async (
  ctx: ScenarioContext,
  cli: AgentShellCli,
  app: AppInstance,
  lan: LanFixture,
) => {
  ctx.log("a fill cut by stopping the server finishes at its next boot");
  // the first request is held until a second arrives: the restarted server's
  lan.gate("/slow", 2);
  const saved = await saveJson(cli, lan.url("/slow"), "--no-wait");
  expectEq(saved.fill, { state: "pending" }, "the held page's fill");
  await pollUntil(
    async () =>
      await Promise.resolve(lan.requests().filter((seen) => seen.path === "/slow").length),
    (count) => count > 0,
    { deadlineMs: 30_000, describe: (count) => `requests for the held page: ${String(count)}` },
  );
  await app.stop();
  const stub = (await onDisk(app, saved.path)) ?? "";
  expect(!stub.includes("\nfetched:"), `the stopped server left its stub unread:\n${stub}`);
  const restarted = await ctx.boot({ name: "capture" });
  // the stop's flush committed the stub, and a fill renames only an untracked stub, so the page
  // fills in under the name it was saved with
  const filled = await pollUntil(
    async () => (await onDisk(restarted, saved.path)) ?? "",
    (content) => content.includes("\nfetched:"),
    {
      deadlineMs: 60_000,
      describe: (content) => `the restarted server's fill of the held page:\n${content}`,
    },
  );
  expect(filled.includes("Its fill was cut by a kill."), `the page's text:\n${filled}`);
  expectEq(
    await onDisk(restarted, "Unsorted/A page read after a restart.md"),
    null,
    "a committed stub keeps its name",
  );
};

export const linkCapture: Scenario = {
  description:
    "a saved LAN-fixture page lands with its kind, url, site, description, cover and canonical text named by its title; a resave answers exists; a loopback, link-local or 404 page keeps the item with its fetch-error; --copy keeps a copy; save - saves stdin's links in order; a fill cut by stopping the server finishes at the next boot under the name it was saved with",
  name: "link-capture",
  run: async (ctx) => {
    const app = await ctx.boot({ name: "capture" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);
    await loopbackRefused(ctx, cli, app);
    // every step after the loopback's reads a page: a machine with no address the guard reads
    // from skips here, through the fixture
    const lan = await startLanFixture(ROUTES);
    try {
      await articleFills(ctx, cli, app, lan);
      await refusalsAndErrors(ctx, cli, app, lan);
      await copyKept(ctx, cli, app, lan);
      await stdinInOrder(ctx, app, lan);
      await killedMidFill(ctx, cli, app, lan);
    } finally {
      await lan.close();
    }
  },
  timeoutMs: 300_000,
};
