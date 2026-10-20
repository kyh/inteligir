// desktop-shell's viewer steps, on WebKitGTK through tauri-driver: what a frame draws is read off
// WebDriver's screenshot of the window, since no script in the page can read a PDF's
// viewer or a sandboxed copy. A PDF item opens in a same-origin frame over the asset route, whose
// policy for a PDF is WebKit's own viewer, and draws its red page; a webm item's player reaches its
// metadata over the byte routes and the boot's media token; and a kept copy of a page is framed by
// its own route under a script-less sandbox, so it draws its own colours while its script never
// runs and never reaches the window.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PAGE_COPY_PATH, VAULT_ASSET_PATH } from "@repo/contract/local/routes";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import { z } from "zod";
import { expect, expectEq } from "../../harness/assert";
import { backToLibrary } from "../../harness/desktop-shell";
import type { DesktopShell } from "../../harness/desktop-shell";
import { readPngPixels } from "../../harness/png-pixels";
import type { Rgba } from "../../harness/png-pixels";
import { pollUntil } from "../../harness/poll";
import type { ScenarioContext } from "../../harness/scenario";
import { doubleClickCard, libraryCard } from "../../harness/selectors";
import type { WebDriverSession } from "../../harness/webdriver";

const SAVED = "saved: 2026-10-01T09:00:00Z";
const PDF_ITEM = "Papers/Red page.md";
const PDF_FILE = "assets/red-page.pdf";
const VIDEO_ITEM = "Clips/Blue clip.md";
const VIDEO_FILE = "assets/blue-clip.webm";
const LINK_ITEM = "Reading/A kept page.md";
const COPY_FILE = "assets/pages/0f1e2d3c4b5a6978.html";
// a second of 64×48 VP8, made once with
// `ffmpeg -f lavfi -i color=c=0x2050c0:s=64x48:d=1:r=10 -c:v libvpx -b:v 20k -auto-alt-ref 0 -an`
const WEBM_FIXTURE = "tools/e2e/src/fixtures/blue-clip.webm";
const PAGE_DEADLINE_MS = 60_000;
const VIEWER_DEADLINE_MS = 45_000;
// how long a script that could run is given to say so
const SILENCE_MS = 3000;

// one US-letter page painted red edge to edge: whatever the viewer's zoom, the middle of its frame
// falls on the page
const pdfOf = (contents: string): Uint8Array => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${String(contents.length)} >>\nstream\n${contents}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(text.length);
    text += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  text += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(text);
};
const RED_PAGE = pdfOf("1 0 0 rg\n0 0 612 792 re\nf");

// the copy's own colour, which only its inline style paints; its script, were it to run, would
// paint it red and tell the window
const COPY_GREEN = "rgb(20, 160, 60)";
const COPY_HTML = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>A kept page</title></head>',
  `<body style="margin:0;min-height:100vh;background:${COPY_GREEN}">`,
  "<p>Kept as it looked.</p>",
  "<script>",
  '  document.body.style.background = "rgb(220, 20, 30)";',
  '  window.parent.postMessage("the copy ran its script", "*");',
  "</script>",
  "</body></html>",
].join("\n");

const wrapper = (id: string, kind: string, embed: string): string =>
  `---\nid: ${id}\nkind: ${kind}\n${SAVED}\n---\n![](${embed})\n`;

const LINK_TEXT = [
  "---",
  "id: 6f0e1d2c-3b4a-4596-8877-a6b5c4d3e2f1",
  "kind: link",
  "url: https://kept-page.invalid/essay",
  SAVED,
  "fetched: 2026-10-01T09:00:05Z",
  "---",
  "",
  "The article's own text, as the fill wrote it.",
  "",
  `[Copy of the page](${COPY_FILE})`,
  "",
].join("\n");

const rectSchema = z.object({ dpr: z.number(), x: z.number(), y: z.number() });

// the middle of the first element `selector` names, in the screenshot's own pixels
const middleOf = async (
  page: WebDriverSession,
  selector: string,
): Promise<{ x: number; y: number }> => {
  const rect = await page.run(
    `const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return box === undefined ? null : { dpr: window.devicePixelRatio, x: box.left + box.width / 2, y: box.top + box.height / 2 };`,
    rectSchema.nullable(),
  );
  expect(rect !== null, `nothing matched ${selector}`);
  return { x: Math.round(rect.x * rect.dpr), y: Math.round(rect.y * rect.dpr) };
};

// a few pixels around the middle, so one glyph or one anti-aliased edge cannot decide it
const pixelsAround = async (
  page: WebDriverSession,
  at: { x: number; y: number },
): Promise<Rgba[]> => {
  const shot = readPngPixels(await page.screenshot());
  return [
    [0, 0],
    [-12, -12],
    [12, -12],
    [-12, 12],
    [12, 12],
  ].map(([dx = 0, dy = 0]) =>
    shot.pixelAt(
      Math.min(Math.max(at.x + dx, 0), shot.width - 1),
      Math.min(Math.max(at.y + dy, 0), shot.height - 1),
    ),
  );
};

const isRed = ([red, green, blue]: Rgba): boolean => red > 180 && green < 90 && blue < 90;
const isGreen = ([red, green, blue]: Rgba): boolean => red < 90 && green > 120 && blue < 120;

const untilFrameShows = async (
  page: WebDriverSession,
  selector: string,
  colour: (pixel: Rgba) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(
    async () => await pixelsAround(page, await middleOf(page, selector)),
    (pixels) => pixels.every(colour),
    {
      deadlineMs: VIEWER_DEADLINE_MS,
      describe: (pixels) => `${what}; the frame's middle reads ${JSON.stringify(pixels)}`,
      intervalMs: 500,
    },
  );
};

// a card selects on a click and opens on a double-click, which WebDriver's element click does
// not make, so the double-click's events are dispatched on the card once it is drawn
const openCard = async (page: WebDriverSession, item: string): Promise<void> => {
  const card = libraryCard(item);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(card)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  expectEq(await page.run(`return ${doubleClickCard(item)};`, z.string()), "double-clicked", item);
};

const pdfDraws = async (page: WebDriverSession): Promise<void> => {
  const frame = '[data-item-stage="pdf"] iframe';
  await openCard(page, PDF_ITEM);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(frame)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const src = await page.run(
    `return document.querySelector(${JSON.stringify(frame)}).getAttribute("src")`,
    z.string(),
  );
  expect(
    src.includes(`${VAULT_ASSET_PATH}?`) &&
      src.includes(encodeURIComponent(PDF_FILE)) &&
      /[?&]m=/u.test(src),
    `the PDF's frame is not the asset route with the media token: ${src}`,
  );
  await untilFrameShows(page, frame, isRed, "the PDF's frame never drew its red page");
  await backToLibrary(page);
};

const mediaStateSchema = z.object({
  error: z.number().nullable(),
  networkState: z.number(),
  readyState: z.number(),
  src: z.string(),
});

const videoLoads = async (page: WebDriverSession): Promise<void> => {
  const video = '[data-item-stage="video"] video';
  await openCard(page, VIDEO_ITEM);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(video)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const state = await pollUntil(
    async () =>
      await page.run(
        `const media = document.querySelector(${JSON.stringify(video)});
        return { error: media.error?.code ?? null, networkState: media.networkState, readyState: media.readyState, src: media.currentSrc };`,
        mediaStateSchema,
      ),
    (seen) => {
      expect(seen.error === null, `the player refused the webm: ${JSON.stringify(seen)}`);
      return seen.readyState >= 1;
    },
    {
      deadlineMs: VIEWER_DEADLINE_MS,
      describe: (seen) => `the webm never reached its metadata: ${JSON.stringify(seen)}`,
      intervalMs: 500,
    },
  );
  expect(
    state.src.includes(encodeURIComponent(VIDEO_FILE)) && /[?&]m=/u.test(state.src),
    `the player's source is not the asset route with the media token: ${state.src}`,
  );
  const duration = await page.run(
    `return document.querySelector(${JSON.stringify(video)}).duration`,
    z.number(),
  );
  expect(duration > 0.5 && duration < 2, `the webm's duration reads ${String(duration)}`);
  await backToLibrary(page);
};

const copyStaysSilent = async (shell: DesktopShell): Promise<void> => {
  const page = shell.window;
  const frame = '[data-item-stage="page-copy"] iframe';
  await page.run(
    `window.e2eMessages = [];
    window.addEventListener("message", (event) => { window.e2eMessages.push(String(event.data)); });
    return null;`,
    z.null(),
  );
  await openCard(page, LINK_ITEM);
  await page.clickButton("Page copy", PAGE_DEADLINE_MS);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(frame)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const framed = await page.run(
    `const node = document.querySelector(${JSON.stringify(frame)});
    return { sandbox: node.getAttribute("sandbox"), src: node.getAttribute("src") ?? "", srcdoc: node.hasAttribute("srcdoc") };`,
    z.object({ sandbox: z.string().nullable(), src: z.string(), srcdoc: z.boolean() }),
  );
  expect(
    framed.src.includes(`${PAGE_COPY_PATH}?`) && /[?&]m=/u.test(framed.src) && !framed.srcdoc,
    `the copy is not framed by its route with the media token: ${JSON.stringify(framed)}`,
  );
  expectEq(framed.sandbox, "", "the copy's frame sandbox");

  // the frame's own url, asked as the window asks it, with the bearer in place of the cookie
  const server = readServerFile(shell.target().dataDir);
  expect(server !== null, "no server.json for the shell's library");
  const answer = await fetch(new URL(framed.src, shell.serverOrigin), {
    headers: { authorization: authorizationHeader(server.token) },
  });
  expectEq(answer.status, 200, "the copy route's answer for the frame's url");
  const policy = answer.headers.get("content-security-policy") ?? "";
  expect(
    policy
      .split(";")
      .map((part) => part.trim())
      .includes("sandbox") &&
      policy.includes("default-src 'none'") &&
      !policy.includes("allow-scripts"),
    `the copy is not served under a script-less sandbox: ${policy}`,
  );
  expectEq(await answer.text(), COPY_HTML, "the copy the route serves");

  await untilFrameShows(page, frame, isGreen, "the copy never drew its own colours");
  await delay(SILENCE_MS);
  await untilFrameShows(page, frame, isGreen, "the copy's colours changed under it");
  const heard = await page.run("return window.e2eMessages ?? []", z.array(z.string()));
  expectEq(heard, [], "what the copy said to the window");
};

// the PDF, the webm and the kept page, with the items that show them, before the shell launches
export const seedViewerItems = async (vaultDir: string, repoRoot: string): Promise<void> => {
  const webm = await readFile(path.join(repoRoot, WEBM_FIXTURE));
  const write = async (file: string, bytes: string | Uint8Array): Promise<void> => {
    await mkdir(path.join(vaultDir, path.dirname(file)), { recursive: true });
    await writeFile(path.join(vaultDir, file), bytes);
  };
  await write(PDF_FILE, RED_PAGE);
  await write(PDF_ITEM, wrapper("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "pdf", PDF_FILE));
  await write(VIDEO_FILE, webm);
  await write(VIDEO_ITEM, wrapper("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "video", VIDEO_FILE));
  await write(COPY_FILE, COPY_HTML);
  await write(LINK_ITEM, LINK_TEXT);
};

// from the library: each viewer opens from its card, and the window is back on the library after
// the PDF and the webm; the page copy stays open
export const viewersDraw = async (ctx: ScenarioContext, shell: DesktopShell): Promise<void> => {
  const page = shell.window;
  ctx.log("a PDF item opens in WebKit's own viewer, and its frame draws the red page");
  await pdfDraws(page);

  ctx.log("a webm item's player reads its metadata over the byte routes");
  await videoLoads(page);

  ctx.log("a kept copy draws its own colours, and its script never runs or reaches the window");
  await copyStaysSilent(shell);
};
