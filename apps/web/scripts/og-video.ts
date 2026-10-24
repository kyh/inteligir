// `pnpm og:video`: captures the site's share media into public/og/, outside the build and the
// gate. Run `pnpm package:cli` first, which builds the server and the workspace page it serves.
//
// - og.mp4 + og-poster.jpg: the REAL workspace, served by the built `inteligir serve` on a scratch
//   vault, with a note rewritten while it is open. Each edit is written to the note's file, the
//   way the agent's own edits reach the vault, and the open editor adopts it live as it does for
//   the agent. The runtime is `scripted`, so nothing signs in and no model runs; the words of the
//   edit are this script's.
// - <page>.jpg: a 1200x630 card per page in src/lib/page-meta.ts, in the site's own type and logo.
//
// Frames are screenshots rather than Playwright's video, whose fixed low bitrate smears text,
// assembled by ffmpeg into an H.264 clip with no audio track.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import {
  browserHandoffUrl,
  HEALTH_PATH,
  healthResponseSchema,
  RPC_PREFIX,
} from "@repo/contract/local/routes";
import { z } from "zod";

import { PAGES } from "../src/lib/page-meta.ts";
import { siteConfig } from "../src/lib/site-config.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const FPS = 30;

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outDir = path.join(webRoot, "public", "og");
const cliEntry = path.join(repoRoot, "apps", "cli", "dist", "index.js");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

const NOTE = "Offsite planning.md";

// the note as a person left it, then each edit the agent makes, in order
const STAGES: readonly string[] = [
  `notes from tuesday call w/ Maya + Jon
- venue? Lisbon or Porto, Maya prefers Porto (cheaper in Oct)
- 14 people, maybe 16 if design joins
- need agenda draft before friday
- jon to check flights, budget ~900/person
- workshop on Q1 roadmap, half day
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
- **Day 2:** half-day workshop on the Q1 roadmap
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
- **Day 2:** half-day workshop on the Q1 roadmap
- **Day 3:** wrap-up and flights home
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
- **Day 2:** half-day workshop on the Q1 roadmap
- **Day 3:** wrap-up and flights home

## Action items

- [ ] Jon: check flights against the $900 budget
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
- **Day 2:** half-day workshop on the Q1 roadmap
- **Day 3:** wrap-up and flights home

## Action items

- [ ] Jon: check flights against the $900 budget
- [ ] Maya: confirm whether design joins
`,
  `Team offsite in Porto, October 14–16, for up to 16 people.

## Agenda

- **Day 1:** arrive, check in, welcome dinner by the river
- **Day 2:** half-day workshop on the Q1 roadmap
- **Day 3:** wrap-up and flights home

## Action items

- [ ] Jon: check flights against the $900 budget
- [ ] Maya: confirm whether design joins
- [ ] Share this agenda with the team by Friday
`,
];

// a vault that reads as someone's, so the sidebar is not a lone file
const SIDE_NOTES = {
  "Meetings/Design review.md": "Walked through the new onboarding screens.\n",
  "Meetings/Weekly sync.md": "Hiring update, launch checklist, open questions.\n",
  "Q4 goals.md": "- Ship the iPhone app\n- Grow the invited group\n",
  "Reading list.md": "- The Mythical Man-Month\n- How to Take Smart Notes\n",
};

const HOLD_START_MS = 1200;
const EDIT_GAP_MS = 650;
const HOLD_END_MS = 2200;

// a port nothing holds now, so a dev server elsewhere on this machine is never the one answered
const freePort = async (): Promise<number> => {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = z.object({ port: z.number() }).parse(probe.address());
  probe.close();
  await once(probe, "close");
  return port;
};

const run = (file: string, args: readonly string[]): void => {
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} exited ${result.status ?? result.signal}`);
  }
};

// server.json is written after listen, so a health answer alone can precede it
const waitForServer = async (origin: string, dataDir: string): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${origin}${HEALTH_PATH}`);
      const healthy = healthResponseSchema.safeParse(await response.json()).success;
      if (healthy && existsSync(path.join(dataDir, "server.json"))) {
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`the server at ${origin} never answered its health check`);
};

const serverFileSchema = z.object({ token: z.string() });
// oRPC's RPC protocol wraps the answer under `json`
const handoffSchema = z.object({ json: z.object({ nonce: z.string() }) });

// the same single-use handoff the shell opens its window with
const handoffUrl = async (origin: string, dataDir: string): Promise<string> => {
  const { token } = serverFileSchema.parse(
    JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf-8")),
  );
  const response = await fetch(`${origin}${RPC_PREFIX}/system/browserHandoff`, {
    body: "{}",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const {
    json: { nonce },
  } = handoffSchema.parse(await response.json());
  return browserHandoffUrl(`${origin}/?note=${encodeURIComponent(NOTE)}`, nonce);
};

interface Frame {
  file: string;
  at: number;
}

// screenshots taken back to back, each stamped: headless Chromium's screencast emits a frame
// only when something else asks for one, so it misses the edits it is meant to catch
const startCapture = (page: Page, framesDir: string) => {
  const frames: Frame[] = [];
  const stopping = new AbortController();
  const loop = (async () => {
    while (!stopping.signal.aborted) {
      const file = path.join(framesDir, `${String(frames.length).padStart(5, "0")}.jpg`);
      const at = performance.now() / 1000;
      await page.screenshot({ path: file, quality: 95, type: "jpeg" });
      frames.push({ at, file });
    }
  })();
  return {
    stop: async (): Promise<Frame[]> => {
      stopping.abort();
      await loop;
      return frames;
    },
  };
};

const encodeClip = async (frames: readonly Frame[], endAt: number, workDir: string) => {
  const [first] = frames;
  if (first === undefined) {
    throw new Error("the capture took no frames");
  }
  // ffmpeg's concat demuxer holds each frame for its duration, and needs the last one repeated
  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1]?.at ?? endAt;
    return [`file '${frame.file}'`, `duration ${Math.max(next - frame.at, 0.001).toFixed(4)}`];
  });
  const last = frames.at(-1) ?? first;
  lines.push(`file '${last.file}'`);
  const list = path.join(workDir, "frames.txt");
  await writeFile(list, `${lines.join("\n")}\n`);
  const clip = path.join(outDir, "og.mp4");
  run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "slow",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    clip,
  ]);
  // the finished note, a beat before the clip ends, is the poster
  run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-sseof",
    "-0.5",
    "-i",
    clip,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    path.join(outDir, "og-poster.jpg"),
  ]);
  const { size } = await stat(clip);
  process.stdout.write(`og.mp4: ${(size / 1024 / 1024).toFixed(2)} MiB\n`);
};

const captureClip = async (workDir: string): Promise<void> => {
  const dataDir = path.join(workDir, "data");
  // the vault's folder name is the name the sidebar shows
  const vaultDir = path.join(workDir, "Notes");
  await mkdir(dataDir, { recursive: true });
  for (const [file, body] of Object.entries({ ...SIDE_NOTES, [NOTE]: STAGES[0] ?? "" })) {
    const target = path.join(vaultDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [cliEntry, "serve"], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: path.join(workDir, "claude"),
      CODEX_HOME: path.join(workDir, "codex"),
      INTELIGIR_AGENT: "scripted",
      INTELIGIR_DATA_DIR: dataDir,
      INTELIGIR_PORT: String(port),
      INTELIGIR_VAULT_DIR: vaultDir,
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  const browser = await chromium.launch();
  try {
    await waitForServer(origin, dataDir);
    const page = await browser.newPage({
      colorScheme: "dark",
      viewport: { height: HEIGHT, width: WIDTH },
    });
    await page.goto(await handoffUrl(origin, dataDir));
    await page.getByText("venue? Lisbon or Porto").waitFor();
    // fonts settled and the caret gone, so the first frame is the page at rest
    await page.mouse.move(WIDTH - 1, HEIGHT - 1);
    await sleep(1500);

    const framesDir = path.join(workDir, "frames");
    await mkdir(framesDir);
    const capture = startCapture(page, framesDir);
    await sleep(HOLD_START_MS);
    for (const stage of STAGES.slice(1)) {
      await writeFile(path.join(vaultDir, NOTE), stage);
      await sleep(EDIT_GAP_MS);
    }
    await page.getByText("Share this agenda").waitFor();
    await sleep(HOLD_END_MS);
    const endAt = performance.now() / 1000;
    const frames = await capture.stop();
    await encodeClip(frames, endAt, workDir);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
};

const fontFile = path.join(
  repoRoot,
  "packages",
  "ui",
  "node_modules",
  "@fontsource-variable",
  "inter",
  "files",
  "inter-latin-wght-normal.woff2",
);

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// the og.jpg look: the logo on near-black, white Inter over a grey line
const cardHtml = (title: string, description: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url("inter.woff2") format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: #171717; }
body { font-family: Inter, sans-serif; color: #fafafa; display: flex; flex-direction: column;
  justify-content: space-between; padding: 72px 80px; box-sizing: border-box; }
.brand { display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 600; }
.brand img { width: 56px; height: 56px; border-radius: 12px; }
h1 { font-size: 76px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 24px; font-weight: 650; }
p { font-size: 30px; line-height: 1.4; color: #a3a3a3; margin: 0; max-width: 960px; }
.url { font-size: 24px; color: #737373; }
</style></head><body>
<div class="brand"><img src="logo.png" alt="">${escapeHtml(siteConfig.name)}</div>
<div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>
<div class="url">${escapeHtml(new URL(siteConfig.url).host)}</div>
</body></html>`;

const renderCards = async (workDir: string): Promise<void> => {
  const cardsDir = path.join(workDir, "cards");
  await mkdir(cardsDir);
  await copyFile(fontFile, path.join(cardsDir, "inter.woff2"));
  await copyFile(
    path.join(webRoot, "public", "favicon", "web-app-manifest-192x192.png"),
    path.join(cardsDir, "logo.png"),
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { height: HEIGHT, width: WIDTH } });
    for (const meta of Object.values(PAGES)) {
      if (meta.kind === "home") {
        continue;
      }
      const html = path.join(cardsDir, `${meta.kind}-${path.basename(meta.image.path)}.html`);
      await writeFile(html, cardHtml(meta.title, meta.description));
      await page.goto(`file://${html}`);
      await page.waitForFunction("document.fonts.status === 'loaded'");
      await page.screenshot({
        path: path.join(webRoot, "public", meta.image.path),
        quality: 90,
        type: "jpeg",
      });
      process.stdout.write(`${meta.image.path}\n`);
    }
  } finally {
    await browser.close();
  }
};

if (!existsSync(cliEntry)) {
  throw new Error(`no built server at ${cliEntry}: run \`pnpm package:cli\` first`);
}
await mkdir(outDir, { recursive: true });
const workDir = await mkdtemp(path.join(tmpdir(), "inteligir-og-"));
try {
  await renderCards(workDir);
  await captureClip(workDir);
} finally {
  await rm(workDir, { force: true, recursive: true });
}
