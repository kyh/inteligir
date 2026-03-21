/**
 * Browser automation tool backed by puppeteer-core connecting to Electron's
 * built-in Chromium via CDP. No external Node.js, npm, or browser downloads
 * required — everything runs in-process.
 *
 * Registered as a pi-coding-agent extension so the agent can browse the web,
 * scrape pages, fill forms, take screenshots, etc.
 */

import { BrowserWindow } from "electron";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Browser lifecycle — lazily create a hidden BrowserWindow with CDP
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let browserWindow: BrowserWindow | null = null;

/**
 * Get or create a puppeteer Browser connected to Electron's Chromium.
 * Uses a hidden BrowserWindow with remote debugging enabled.
 */
async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;

  // Clean up stale references
  await disposeBrowser();

  browserWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      // Minimal privileges — this window is only used for CDP automation
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Enable CDP on the webContents and connect puppeteer-core
  const debugger_ = browserWindow.webContents.debugger;
  debugger_.attach("1.3");

  // Get the debugging URL from Electron's built-in debugging server
  const wsUrl = browserWindow.webContents.debugger.isAttached()
    ? await getDebuggerWebSocketUrl(browserWindow)
    : null;

  if (!wsUrl) {
    throw new Error("Failed to get CDP WebSocket URL from Electron");
  }

  browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  return browser;
}

async function getDebuggerWebSocketUrl(win: BrowserWindow): Promise<string> {
  const contents = win.webContents;
  const { targetInfo } = (await contents.debugger.sendCommand(
    "Target.getTargetInfo",
  )) as { targetInfo: { targetId: string } };

  const { app } = await import("electron");
  const port = await startDebuggingServer(app);
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const data = (await response.json()) as { webSocketDebuggerUrl: string };

  const baseWs = data.webSocketDebuggerUrl;
  return baseWs.replace(/\/devtools\/browser\/.*/, `/devtools/page/${targetInfo.targetId}`);
}

let debugPort: number | null = null;

async function startDebuggingServer(app: Electron.App): Promise<number> {
  if (debugPort) return debugPort;

  const net = await import("node:net");

  debugPort = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        const p = addr.port;
        server.close(() => {
          app.commandLine.appendSwitch("remote-debugging-port", String(p));
          resolve(p);
        });
      } else {
        server.close();
        reject(new Error("Failed to get port"));
      }
    });
  });

  return debugPort;
}

async function disposeBrowser(): Promise<void> {
  if (browser) {
    try {
      browser.disconnect();
    } catch {
      /* already disconnected */
    }
    browser = null;
  }
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.close();
  }
  browserWindow = null;
}

// ---------------------------------------------------------------------------
// Page management
// ---------------------------------------------------------------------------

async function getActivePage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();
  return pages[0] ?? (await b.newPage());
}

// ---------------------------------------------------------------------------
// Result helpers — must match pi-ai's TextContent / ImageContent interfaces
// ---------------------------------------------------------------------------

type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; details: Record<string, never> };

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], details: {} };
}

function image(base64: string, mimeType: string): ToolResult {
  return { content: [{ type: "image", data: base64, mimeType }], details: {} };
}

async function safeScreenshot(page: Page, fullPage: boolean): Promise<string> {
  const buf = await page.screenshot({
    encoding: "base64",
    fullPage,
    type: "png",
  });
  return typeof buf === "string" ? buf : Buffer.from(buf).toString("base64");
}

/**
 * Build a compact accessibility-tree snapshot with element refs (@e1, @e2…)
 * that the agent can use for precise element targeting.
 */
async function buildSnapshot(page: Page): Promise<string> {
  const tree = await page.accessibility.snapshot();
  if (!tree) return "(empty page)";

  let refCounter = 0;

  type SnapNode = NonNullable<Awaited<ReturnType<typeof page.accessibility.snapshot>>>;

  function walk(node: SnapNode, depth: number): string {
    const indent = "  ".repeat(depth);
    const role = node.role ?? "unknown";
    const name = node.name ?? "";
    const value = node.value as string | undefined ?? "";

    let refLabel = "";
    const interactiveRoles = new Set([
      "link", "button", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton",
    ]);
    if (interactiveRoles.has(role)) {
      refCounter++;
      refLabel = ` @e${refCounter}`;
    }

    const parts = [`${indent}[${role}]${refLabel}`];
    if (name) parts.push(`"${name}"`);
    if (value) parts.push(`value="${value}"`);

    const line = parts.join(" ");
    const children = node.children;
    if (Array.isArray(children)) {
      const childLines = children
        .map((c) => walk(c, depth + 1))
        .filter(Boolean);
      return [line, ...childLines].join("\n");
    }
    return line;
  }

  return walk(tree, 0);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const BrowserActionSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("open"),
      Type.Literal("click"),
      Type.Literal("fill"),
      Type.Literal("type"),
      Type.Literal("press"),
      Type.Literal("hover"),
      Type.Literal("select"),
      Type.Literal("snapshot"),
      Type.Literal("screenshot"),
      Type.Literal("get_text"),
      Type.Literal("get_url"),
      Type.Literal("get_title"),
      Type.Literal("evaluate"),
      Type.Literal("wait"),
      Type.Literal("scroll"),
      Type.Literal("back"),
      Type.Literal("forward"),
      Type.Literal("reload"),
      Type.Literal("close"),
    ],
    { description: "Browser action to perform" },
  ),
  url: Type.Optional(Type.String({ description: "URL (for open action)" })),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS selector or @ref from snapshot (e.g. @e1). Used for click, fill, type, hover, select, get_text, wait.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "Text value (for fill, type actions) or key name (for press)",
    }),
  ),
  script: Type.Optional(
    Type.String({ description: "JavaScript to evaluate (for evaluate action)" }),
  ),
  direction: Type.Optional(
    Type.Union([Type.Literal("up"), Type.Literal("down")], {
      description: "Scroll direction (default: down)",
    }),
  ),
  amount: Type.Optional(
    Type.Number({ description: "Scroll amount in pixels (default: 500)" }),
  ),
  fullPage: Type.Optional(
    Type.Boolean({ description: "Full page screenshot (default: false)" }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in ms for wait action (default: 5000)" }),
  ),
});

type BrowserAction = Static<typeof BrowserActionSchema>;

// ---------------------------------------------------------------------------
// Ref resolution — maps @eN refs from snapshots to CSS selectors
// ---------------------------------------------------------------------------

const refSelectors = new Map<string, string>();

function resolveSelector(selector: string): string {
  if (!selector.startsWith("@e")) return selector;

  const refInfo = refSelectors.get(selector);
  if (refInfo) return refInfo;

  throw new Error(
    `Unknown ref "${selector}". Run the "snapshot" action first to get element refs.`,
  );
}

/**
 * Rebuild the ref → CSS-selector map after a snapshot.
 */
async function rebuildRefMap(page: Page): Promise<void> {
  refSelectors.clear();

  const refs: { index: number; selector: string }[] = await page.evaluate(() => {
    const interactiveRoles = new Set([
      "link", "button", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton",
    ]);

    const results: { index: number; selector: string }[] = [];
    let counter = 0;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
    );

    let node: Node | null = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement) {
        const role =
          node.getAttribute("role") ?? inferRole(node.tagName.toLowerCase());
        if (role && interactiveRoles.has(role)) {
          counter++;
          const selector = buildUniqueSelector(node);
          results.push({ index: counter, selector });
        }
      }
      node = walker.nextNode();
    }

    return results;

    function inferRole(tag: string): string | null {
      const map: Record<string, string> = {
        a: "link",
        button: "button",
        input: "textbox",
        textarea: "textbox",
        select: "combobox",
      };
      return map[tag] ?? null;
    }

    function buildUniqueSelector(el: HTMLElement): string {
      if (el.id) return `#${CSS.escape(el.id)}`;

      const label = el.getAttribute("aria-label");
      if (label) {
        const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
        return `${role}[aria-label="${CSS.escape(label)}"]`;
      }

      const parts: string[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        const parent = cur.parentElement;
        if (!parent) break;
        const tag = cur.tagName;
        const siblings = (Array.from(parent.children) as Element[]).filter(
          (c) => c.tagName === tag,
        );
        const idx = siblings.indexOf(cur) + 1;
        const tagLower = tag.toLowerCase();
        parts.unshift(
          siblings.length > 1 ? `${tagLower}:nth-of-type(${idx})` : tagLower,
        );
        cur = parent;
      }
      return parts.join(" > ");
    }
  });

  for (const { index, selector } of refs) {
    refSelectors.set(`@e${index}`, selector);
  }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

async function executeBrowserAction(action: BrowserAction): Promise<ToolResult> {
  switch (action.action) {
    case "open": {
      if (!action.url) return text("Error: url is required for open action");
      const page = await getActivePage();
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return text(`Navigated to ${action.url}`);
    }

    case "click": {
      if (!action.selector) return text("Error: selector is required for click");
      const page = await getActivePage();
      const sel = resolveSelector(action.selector);
      await page.click(sel);
      return text(`Clicked ${action.selector}`);
    }

    case "fill": {
      if (!action.selector) return text("Error: selector is required for fill");
      if (action.text === undefined) return text("Error: text is required for fill");
      const page = await getActivePage();
      const sel = resolveSelector(action.selector);
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(sel, action.text);
      return text(`Filled ${action.selector} with "${action.text}"`);
    }

    case "type": {
      if (!action.text) return text("Error: text is required for type");
      const page = await getActivePage();
      if (action.selector) {
        const sel = resolveSelector(action.selector);
        await page.type(sel, action.text);
      } else {
        await page.keyboard.type(action.text);
      }
      return text(`Typed "${action.text}"`);
    }

    case "press": {
      if (!action.text) return text("Error: text (key name) is required for press");
      const page = await getActivePage();
      await page.keyboard.press(action.text as Parameters<typeof page.keyboard.press>[0]);
      return text(`Pressed ${action.text}`);
    }

    case "hover": {
      if (!action.selector) return text("Error: selector is required for hover");
      const page = await getActivePage();
      const sel = resolveSelector(action.selector);
      await page.hover(sel);
      return text(`Hovered ${action.selector}`);
    }

    case "select": {
      if (!action.selector) return text("Error: selector is required for select");
      if (!action.text) return text("Error: text (option value) is required for select");
      const page = await getActivePage();
      const sel = resolveSelector(action.selector);
      await page.select(sel, action.text);
      return text(`Selected "${action.text}" in ${action.selector}`);
    }

    case "snapshot": {
      const page = await getActivePage();
      await rebuildRefMap(page);
      const snapshot = await buildSnapshot(page);
      return text(snapshot);
    }

    case "screenshot": {
      const page = await getActivePage();
      const base64 = await safeScreenshot(page, action.fullPage ?? false);
      return image(base64, "image/png");
    }

    case "get_text": {
      const page = await getActivePage();
      let result: string;
      if (action.selector) {
        const sel = resolveSelector(action.selector);
        const el = await page.$(sel);
        result = el
          ? ((await el.evaluate((e) => e.textContent)) ?? "")
          : "(element not found)";
      } else {
        result = (await page.evaluate(() => document.body.innerText)) ?? "";
      }
      return text(result);
    }

    case "get_url": {
      const page = await getActivePage();
      return text(page.url());
    }

    case "get_title": {
      const page = await getActivePage();
      return text(await page.title());
    }

    case "evaluate": {
      if (!action.script) return text("Error: script is required for evaluate");
      const page = await getActivePage();
      const result = await page.evaluate(action.script);
      return text(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    }

    case "wait": {
      const page = await getActivePage();
      const ms = action.timeout ?? 5000;
      if (action.selector) {
        const sel = resolveSelector(action.selector);
        await page.waitForSelector(sel, { timeout: ms });
        return text(`Found ${action.selector}`);
      }
      await new Promise((resolve) => setTimeout(resolve, ms));
      return text(`Waited ${ms}ms`);
    }

    case "scroll": {
      const page = await getActivePage();
      const dir = action.direction ?? "down";
      const amt = action.amount ?? 500;
      const delta = dir === "down" ? amt : -amt;
      await page.evaluate((d) => window.scrollBy(0, d), delta);
      return text(`Scrolled ${dir} ${amt}px`);
    }

    case "back": {
      const page = await getActivePage();
      await page.goBack({ waitUntil: "domcontentloaded" });
      return text("Navigated back");
    }

    case "forward": {
      const page = await getActivePage();
      await page.goForward({ waitUntil: "domcontentloaded" });
      return text("Navigated forward");
    }

    case "reload": {
      const page = await getActivePage();
      await page.reload({ waitUntil: "domcontentloaded" });
      return text("Reloaded page");
    }

    case "close": {
      await disposeBrowser();
      return text("Browser closed");
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerBrowserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser",
    label: "browser",
    description:
      "Browse the web, interact with pages, take screenshots, and extract data. " +
      "Uses a built-in browser — no external tools required. " +
      "Workflow: open a URL → snapshot to see elements → interact using @refs → extract or screenshot.",
    parameters: BrowserActionSchema,
    execute: async (_toolCallId, params) => {
      try {
        return await executeBrowserAction(params);
      } catch (err) {
        return text(
          `Browser error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

/**
 * Clean up browser resources. Call during app shutdown.
 */
export async function disposeBrowserTool(): Promise<void> {
  await disposeBrowser();
}
