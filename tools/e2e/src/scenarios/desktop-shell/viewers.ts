// desktop-shell's file steps, on WebKitGTK through tauri-driver: the library's files reach the page
// only through the shell's own scheme, which serves a file it holds and fetches one it does not
// from the cloud with the device's credential. A picture's card draws its cover, and a PDF item
// opens in WebKit's own viewer over the scheme and draws its red page, which only WebDriver's
// screenshot of the window can read. A recording is the owner's to play on a Mac
// (docs/releasing.md § 5): WebKitGTK's player loads nothing from a custom scheme, whatever the
// scheme answers, so this engine cannot show it.

import type { V1Client } from "@repo/contract/cloud/v1";
import { z } from "zod";
import { expect } from "../../harness/assert";
import { backToLibrary } from "../../harness/desktop-shell";
import { readPngPixels } from "../../harness/png-pixels";
import type { Rgba } from "../../harness/png-pixels";
import { pollUntil } from "../../harness/poll";
import type { ScenarioContext } from "../../harness/scenario";
import { doubleClickCard, libraryCard } from "../../harness/selectors";
import { newItemId } from "../../harness/v1-wire";
import type { WebDriverSession } from "../../harness/webdriver";

// a 2×2 red PNG
const RED_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const FILES_SCHEME = "inteligir-files://localhost/";
const PAGE_DEADLINE_MS = 60_000;
const VIEWER_DEADLINE_MS = 45_000;

// one US-letter page painted red edge to edge: whatever the viewer's zoom, the middle of its frame
// falls on the page
const pdfOf = (contents: string): Uint8Array<ArrayBuffer> => {
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

export interface ViewerItems {
  readonly picture: string;
  readonly pdf: string;
}

type Upload = (file: {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
}) => Promise<string>;

// the picture and the PDF as file items, uploaded as a device uploads them
export const seedViewerItems = async (
  library: V1Client["library"],
  upload: Upload,
): Promise<ViewerItems> => {
  const make = async (name: string, bytes: Uint8Array<ArrayBuffer>, type: string) => {
    const sha = await upload({ bytes, type });
    const { item } = await library.items.createFile({
      folderId: null,
      id: newItemId(),
      name,
      savedAt: Date.now(),
      sha,
      tags: [],
    });
    return item.id;
  };
  return {
    pdf: await make("red-page.pdf", RED_PAGE, "application/pdf"),
    picture: await make("red.png", RED_PNG, "image/png"),
  };
};

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

// a card selects on a click and opens on a double-click, which WebDriver's element click does
// not make, so the double-click's events are dispatched on the card once it is drawn
const openCard = async (page: WebDriverSession, itemId: string): Promise<void> => {
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(libraryCard(itemId))}) !== null`,
    PAGE_DEADLINE_MS,
  );
  expect(
    (await page.run(`return ${doubleClickCard(itemId)};`, z.string())) === "opened",
    `the card of ${itemId} did not open`,
  );
};

const pictureDraws = async (page: WebDriverSession, itemId: string): Promise<void> => {
  const cover = `${libraryCard(itemId)} img`;
  await pollUntil(
    async () =>
      await page.run(
        `const img = document.querySelector(${JSON.stringify(cover)});
        return img === null ? null : { src: img.currentSrc, width: img.naturalWidth };`,
        z.object({ src: z.string(), width: z.number() }).nullable(),
      ),
    (drawn) => drawn !== null && drawn.width > 0,
    {
      deadlineMs: VIEWER_DEADLINE_MS,
      describe: (drawn) => `the picture's card never drew its cover: ${JSON.stringify(drawn)}`,
    },
  );
  const src = await page.run(
    `return document.querySelector(${JSON.stringify(cover)}).currentSrc`,
    z.string(),
  );
  expect(src.startsWith(FILES_SCHEME), `the cover is not drawn from the shell's scheme: ${src}`);
};

const pdfDraws = async (page: WebDriverSession, itemId: string): Promise<void> => {
  const viewer = 'object[type="application/pdf"]';
  await openCard(page, itemId);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(viewer)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const data = await page.run(
    `return document.querySelector(${JSON.stringify(viewer)}).getAttribute("data")`,
    z.string(),
  );
  expect(data.startsWith(FILES_SCHEME), `the PDF is not drawn from the shell's scheme: ${data}`);
  await pollUntil(
    async () => await pixelsAround(page, await middleOf(page, viewer)),
    (pixels) => pixels.every(isRed),
    {
      deadlineMs: VIEWER_DEADLINE_MS,
      describe: (pixels) =>
        `the PDF's viewer never drew its red page; its middle reads ${JSON.stringify(pixels)}`,
      intervalMs: 500,
    },
  );
  await backToLibrary(page);
};

// from the library: the picture's card, then the PDF opened from its card and left for the
// library again
export const viewersDraw = async (
  ctx: ScenarioContext,
  page: WebDriverSession,
  items: ViewerItems,
): Promise<void> => {
  ctx.log("a picture's card draws its cover over the shell's scheme, fetched with the credential");
  await pictureDraws(page, items.picture);
  ctx.log("a PDF item opens in WebKit's own viewer over the scheme, and draws its red page");
  await pdfDraws(page, items.pdf);
};
