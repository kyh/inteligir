// `pnpm og:cards`: renders a 1200x630 card per page in src/lib/page-meta.ts into public/og/, in
// the site's own type and logo, outside the build and the gate. The home page keeps its own og.jpg.

import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

import { PAGES } from "../src/lib/page-meta.ts";
import { siteConfig } from "../src/lib/site-config.ts";

const WIDTH = 1200;
const HEIGHT = 630;

const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outDir = path.join(webRoot, "public", "og");

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

await mkdir(outDir, { recursive: true });
const workDir = await mkdtemp(path.join(tmpdir(), "inteligir-og-"));
try {
  await renderCards(workDir);
} finally {
  await rm(workDir, { force: true, recursive: true });
}
