// `pnpm og:video`: renders the site's share media into public/og/, outside the build and the gate.
//
// - og.mp4 + og-poster.jpg: a recording of og-video/scene.html, a simplified Inteligir window
//   built from the app's own type, dark tokens and mark (never the running app). The user asks
//   the agent beside a rough note, the agent's edits stream into it, then the icon over the
//   tagline, then the loop.
//   The scene is a pure function of time: each frame is seek(t) and one screenshot at 2x, so a
//   run records the same clip every time, downscaled by ffmpeg to a 1200x630 H.264 clip with no
//   audio track.
// - <page>.jpg: a 1200x630 card per page in src/lib/page-meta.ts, in the site's own type and logo.

import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { z } from "zod";

import { PAGES } from "../src/lib/page-meta.ts";
import { siteConfig } from "../src/lib/site-config.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const FPS = 30;

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outDir = path.join(webRoot, "public", "og");
const sceneFile = path.join(import.meta.dirname, "og-video", "scene.html");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

const run = (file: string, args: readonly string[]): void => {
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} exited ${result.status ?? result.signal}`);
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

// the scene beside the two files it loads, so file:// serves all three
const stageAssets = async (dir: string): Promise<void> => {
  await mkdir(dir);
  await copyFile(fontFile, path.join(dir, "inter.woff2"));
  await copyFile(
    path.join(webRoot, "public", "favicon", "favicon.svg"),
    path.join(dir, "favicon.svg"),
  );
};

const recordScene = async (workDir: string): Promise<void> => {
  const sceneDir = path.join(workDir, "scene");
  await stageAssets(sceneDir);
  await copyFile(sceneFile, path.join(sceneDir, "scene.html"));
  const framesDir = path.join(workDir, "frames");
  await mkdir(framesDir);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { height: HEIGHT, width: WIDTH },
    });
    await page.goto(`file://${path.join(sceneDir, "scene.html")}`);
    await page.waitForFunction("document.fonts.status === 'loaded'");
    const duration = z.number().parse(await page.evaluate("window.SCENE_DURATION"));
    const frames = Math.round(duration * FPS);
    for (let frame = 0; frame < frames; frame += 1) {
      await page.evaluate(`window.seek(${frame / FPS})`);
      await page.screenshot({
        path: path.join(framesDir, `${String(frame).padStart(5, "0")}.png`),
      });
    }
  } finally {
    await browser.close();
  }

  const clip = path.join(outDir, "og.mp4");
  run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    path.join(framesDir, "%05d.png"),
    "-vf",
    `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "slow",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    clip,
  ]);
  // the finished note, just before the window gives way to the mark
  run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    "6.7",
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

await mkdir(outDir, { recursive: true });
const workDir = await mkdtemp(path.join(tmpdir(), "inteligir-og-"));
try {
  await renderCards(workDir);
  await recordScene(workDir);
} finally {
  await rm(workDir, { force: true, recursive: true });
}
