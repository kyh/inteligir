// the browser's door over the real composition: frames in on one PassThrough, frames out on
// another, the server reached as the leaf reaches it. Only the app's opening is a fake, and the
// server's whereabouts when a case needs it absent.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { BROWSER_WIRE_VERSION, browserHostReplySchema } from "@repo/contract/browser/browser-wire";
import type { BrowserHostReply, BrowserHostRequest } from "@repo/contract/browser/browser-wire";
import { EXTENSION_ORIGIN } from "@repo/contract/browser/extension-identity";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../cli-error";
import { runCliForTest } from "../test-support/run-cli";
import {
  bootTestApp,
  listenTestApp,
  makeTempDir,
  TEST_SERVER_TOKEN,
} from "../server/test-support/boot-app";
import type { BootedTestApp } from "../server/test-support/boot-app";
import { loopbackOrigin } from "../server/server-file";
import type { ResolvedServer } from "../server-discovery";
import { createFrameReader, encodeFrame } from "./frames";
import type { AppPlacement } from "./open-app";
import { runNativeHost } from "./run-native-host";
import type { NativeHostDeps } from "./run-native-host";

const ARTICLE_URL = "https://pages.test/essays/file-over-app";
const ARTICLE_HTML =
  "<!doctype html><html><head><title>File over app</title></head><body><article><h1>File over app</h1><p>Apps are ephemeral, and the files they write outlast every one of them.</p></article></body></html>";
// a 1×1 transparent PNG
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const unreachable = (): CliExitError =>
  new CliExitError("No inteligir server is running (test)", { code: "SERVER_UNREACHABLE" });

interface Harness {
  booted: BootedTestApp;
  server: ResolvedServer;
}

// per test, as every booted suite is: the instance and its listener go when the test does
const bootHarness = async (): Promise<Harness> => {
  const booted = await bootTestApp();
  const { port } = await listenTestApp(booted);
  return {
    booted,
    server: {
      baseUrl: loopbackOrigin(port),
      dataDir: booted.dataDir,
      token: TEST_SERVER_TOKEN,
      vaultDir: booted.vaultDir,
    },
  };
};

// a server nothing should ever dial: the cases that refuse before reaching one
const NO_SERVER: ResolvedServer = {
  baseUrl: "http://127.0.0.1:9",
  dataDir: "/no/data",
  token: "no-token",
  vaultDir: "/no/vault",
};

interface HostRun {
  code: number;
  replies: BrowserHostReply[];
  // whatever the output held past its last whole frame
  leftover: number;
  opened: AppPlacement[];
}

type HostOptions = Partial<Pick<NativeHostDeps, "env" | "homeDir" | "reachDeadlineMs">> & {
  origin?: string;
  // the server's whereabouts: one nothing dials unless a case says otherwise
  resolveServer?: () => ResolvedServer;
};

// requests are written as the browser writes them, all at once, then the input ends
const host = async (
  requests: readonly (BrowserHostRequest | Buffer)[],
  options: HostOptions = {},
): Promise<HostRun> => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.end(
    Buffer.concat(
      requests.map((request) => (Buffer.isBuffer(request) ? request : encodeFrame(request))),
    ),
  );
  const opened: AppPlacement[] = [];
  const deps: NativeHostDeps = {
    env: options.env ?? {},
    homeDir: options.homeDir,
    openApp: (placement) => {
      opened.push(placement);
      return true;
    },
    resolveServer: options.resolveServer ?? (() => NO_SERVER),
  };
  if (options.reachDeadlineMs !== undefined) {
    deps.reachDeadlineMs = options.reachDeadlineMs;
  }
  const code = await runNativeHost({ input, output }, options.origin ?? EXTENSION_ORIGIN, deps);
  const all = Buffer.concat(chunks);
  const reader = createFrameReader();
  const events = reader.push(all);
  const replies = events.map((event) => {
    if (event.kind !== "message") {
      throw new Error("the host wrote a malformed frame");
    }
    return browserHostReplySchema.parse(event.value);
  });
  const framed = replies.reduce((bytes, reply) => bytes + encodeFrame(reply).length, 0);
  return { code, leftover: all.length - framed, opened, replies };
};

const v = BROWSER_WIRE_VERSION;

const pageSave = (selection: string | null = null): BrowserHostRequest => ({
  save: {
    keepCopy: false,
    page: {
      html: ARTICLE_HTML,
      selection: selection === null ? null : { text: selection },
      title: "File over app",
      url: ARTICLE_URL,
    },
    target: "page",
  },
  type: "save",
  v,
});

const frontmatterOf = (file: string): string => {
  const content = readFileSync(file, "utf-8");
  return content.split("\n---\n")[0] ?? "";
};

describe("the browser's door", { timeout: 60_000 }, () => {
  it("answers hello with the app's version and the library's name", async () => {
    const harness = await bootHarness();
    const status = await harness.booted.client.system.status();
    const run = await host([{ type: "hello", v }], { resolveServer: () => harness.server });
    expect(run).toMatchObject({ code: 0, leftover: 0, opened: [] });
    expect(run.replies).toEqual([
      {
        appVersion: status.version,
        library: path.basename(harness.booted.vaultDir),
        type: "hello",
        v,
      },
    ]);
  });

  it("saves the page into Unsorted with its kind, url and title, and a second save says it is there", async () => {
    const harness = await bootHarness();
    const reached = { resolveServer: () => harness.server };
    const first = await host([pageSave()], reached);
    expect(first.code).toBe(0);
    expect(first.replies).toEqual([
      {
        created: true,
        path: "Unsorted/File over app.md",
        title: "File over app",
        type: "saved",
        v,
      },
    ]);
    const file = path.join(harness.booted.vaultDir, "Unsorted", "File over app.md");
    expect(existsSync(file)).toBe(true);
    const frontmatter = frontmatterOf(file);
    expect(frontmatter).toMatch(/^kind: \S+$/mu);
    expect(frontmatter).toContain(`url: ${ARTICLE_URL}`);

    const again = await host([pageSave("Apps are ephemeral")], reached);
    expect(again.replies).toEqual([
      {
        created: false,
        path: "Unsorted/File over app.md",
        title: "File over app",
        type: "saved",
        v,
      },
    ]);
    const { annotations } = await harness.booted.client.annotations.list({
      path: "Unsorted/File over app.md",
    });
    expect(annotations.map((annotation) => annotation.quote)).toContain("Apps are ephemeral");
  });

  it("saves a link with its title, and an image's bytes as a picture item", async () => {
    const harness = await bootHarness();
    const run = await host(
      [
        {
          save: { target: "link", title: "  A linked essay ", url: "https://pages.test/linked" },
          type: "save",
          v,
        },
        {
          save: {
            src: { base64: PIXEL_PNG, kind: "bytes", mime: "Image/PNG; charset=binary" },
            target: "image",
          },
          type: "save",
          v,
        },
      ],
      { resolveServer: () => harness.server },
    );
    expect(run.code).toBe(0);
    expect(run.replies).toMatchObject([
      { created: true, path: "Unsorted/A linked essay.md", type: "saved" },
      { created: true, type: "saved" },
    ]);
    const [, picture] = run.replies;
    expect(picture?.type === "saved" && picture.path.startsWith("Unsorted/")).toBe(true);
  });

  it("refuses bytes a page names as anything but a picture, so a page never chooses what is kept", async () => {
    const harness = await bootHarness();
    const run = await host(
      [
        {
          save: {
            src: {
              base64: Buffer.from("<script>1</script>").toString("base64"),
              kind: "bytes",
              mime: "text/html",
            },
            target: "image",
          },
          type: "save",
          v,
        },
        { save: { target: "link", title: null, url: "chrome://settings" }, type: "save", v },
      ],
      { resolveServer: () => harness.server },
    );
    expect(run.replies.map((reply) => reply.type === "refused" && reply.reason)).toEqual([
      "unsupported-page",
      "unsupported-page",
    ]);
  });

  it("tells a newer extension to update the app, and an older one to update itself", async () => {
    const run = await host([
      { type: "hello", v: 2 },
      { type: "hello", v: 0 },
    ]);
    expect(run.replies.map((reply) => reply.type === "refused" && reply.reason)).toEqual([
      "update-app",
      "update-extension",
    ]);
  });

  it("answers a frame it cannot read and goes on, writing exactly one frame per request", async () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(4, 0);
    const harness = await bootHarness();
    const run = await host(
      [{ type: "hello", v }, Buffer.concat([header, Buffer.from("nope")]), { type: "hello", v }],
      { resolveServer: () => harness.server },
    );
    expect(run.code).toBe(0);
    expect(run.leftover).toBe(0);
    expect(run.replies.map((reply) => reply.type)).toEqual(["hello", "refused", "hello"]);
  });

  it("exits 1 for any other extension, having written nothing", async () => {
    const run = await host([{ type: "hello", v }], {
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
    });
    expect(run).toEqual({ code: 1, leftover: 0, opened: [], replies: [] });
  });

  it("opens a packaged app behind the browser once and picks its server up when it answers", async () => {
    const harness = await bootHarness();
    let calls = 0;
    const run = await host([{ type: "hello", v }], {
      env: { INTELIGIR_DATA_DIR: harness.booted.dataDir, NODE_ENV: "production" },
      resolveServer: () => {
        calls += 1;
        if (calls < 3) {
          throw unreachable();
        }
        return harness.server;
      },
    });
    expect(run.opened).toEqual(["behind"]);
    expect(run.replies.map((reply) => reply.type)).toEqual(["hello"]);
  });

  it("answers app-unavailable once the wait runs out", async () => {
    const run = await host([pageSave()], {
      env: {
        INTELIGIR_DATA_DIR: makeTempDir("inteligir-native-host-data-"),
        NODE_ENV: "production",
      },
      reachDeadlineMs: 600,
      resolveServer: () => {
        throw unreachable();
      },
    });
    expect(run.opened).toEqual(["behind"]);
    expect(run.replies).toMatchObject([{ reason: "app-unavailable", type: "refused" }]);
  });

  it("waits for no dev server, since nothing would start one", async () => {
    const started = Date.now();
    const run = await host([{ type: "hello", v }], {
      env: { INTELIGIR_DATA_DIR: makeTempDir("inteligir-native-host-data-") },
      resolveServer: () => {
        throw unreachable();
      },
    });
    expect(run.opened).toEqual([]);
    expect(run.replies).toMatchObject([{ reason: "app-unavailable", type: "refused" }]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("brings a Mac still in its first run to the front and says to finish setting up", async () => {
    const run = await host([pageSave()], {
      env: { NODE_ENV: "production" },
      homeDir: makeTempDir("inteligir-native-host-home-"),
      resolveServer: () => {
        throw unreachable();
      },
    });
    expect(run.opened).toEqual(["front"]);
    expect(run.replies).toMatchObject([{ reason: "not-set-up", type: "refused" }]);
  });

  it("opens the app in front when asked", async () => {
    const run = await host([{ type: "open-app", v }]);
    expect(run.opened).toEqual(["front"]);
    expect(run.replies).toEqual([{ type: "opened", v }]);
  });
});

describe("the native-host leaf", () => {
  it("answers its exit code through the leaf for another extension, and writes nothing to stdout", async () => {
    const result = await runCliForTest({
      argv: ["native-host", "chrome-extension://not-the-extension/"],
      baseUrl: null,
    });
    expect(result).toEqual({ code: 1, stderr: "", stdout: "" });
    expect(process.exitCode).toBeUndefined();
  });

  it("refuses --install in the packaged mode, whose door the app writes itself", async () => {
    const result = await runCliForTest({
      argv: ["native-host", "--install"],
      baseUrl: null,
      env: { NODE_ENV: "production" },
      homeDir: makeTempDir("inteligir-native-host-home-"),
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("the Inteligir app writes its own");
  });
});
