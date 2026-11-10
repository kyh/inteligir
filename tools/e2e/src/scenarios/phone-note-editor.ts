// The phone's note page as the app ships it: the DOM component's page `expo export` writes, loaded
// from `file://` at an iPhone's size, in a stand-in for react-native-webview whose native end this
// scenario is. It answers each action the page asks with the phone's own note actions, over a
// phone runtime signed in to a booted Worker, and moves the page's props as Expo's webview-wrapper
// does (expo/src/dom/webview-wrapper.tsx). The page is handed a link to the Worker as its cloud, so
// the scenario can cut its connection.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { libraryBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { noteActions } from "@repo/mobile/editor/note-actions";
import { z } from "zod";

import { caretToEndOf, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { libraryOf, signedInPhone } from "../harness/phone-runtime";
import { pollUntil } from "../harness/poll";
import { solidPng } from "../harness/png-pixels";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";
import { turboBuildOnce } from "../harness/turbo-build";
import { newItemId } from "../harness/v1-wire";

// a cold `expo export` of the app and its DOM component; a cached one returns at once
const BUILD_TIMEOUT_MS = 300_000;
const DEADLINE_MS = 30_000;
// how often the native end reads what the page posted
const PUMP_EVERY_MS = 100;

// each line stays on one line at the phone's width once typed into, where End is its end
const FIRST_LINE = "Herons wait.";
const SECOND_LINE = "Tide at noon.";
const FROM_PHONE = " From the phone.";
const FROM_MAC = " From the Mac.";
const AFTER_OFFLINE = " Back online.";
const OTHER_TITLE = "Tide tables";
const WEB_IMAGE_HOST = "images.example.test";
const WEB_IMAGE = `https://${WEB_IMAGE_HOST}/heron.png`;
// one red pixel, a PNG Chromium decodes
const PIXEL = solidPng(1, 1, [255, 0, 0, 255]);
const PIXEL_BASE64 = Buffer.from(PIXEL).toString("base64");
const PIXEL_SHA = createHash("sha256").update(PIXEL).digest("hex");

// every function prop the item screen hands the page (apps/mobile/src/editor/use-note-page.ts),
// each a native action
const ACTIONS = [
  "socketTicket",
  "readItem",
  "linkTargets",
  "readFile",
  "keepFile",
  "createNote",
  "openItem",
  "noteState",
  "settled",
] as const;
type ActionId = (typeof ACTIONS)[number];

// the page's other props, which Expo sends whole on every native render
interface PageProps {
  readonly itemId: string;
  readonly cloudOrigin: string;
  readonly offline: boolean;
  readonly moved: { readonly seq: number; readonly ids: readonly string[] | null };
  readonly settle: number;
  readonly focus: boolean;
}

const noteStateSchema = z.enum(["none", "reading", "editing"]);
const settledSchema = z.object({ ask: z.number(), holds: z.boolean() });
const fileSchema = z.object({ base64: z.string(), mediaType: z.string() });
const newNoteSchema = z.object({ blocks: z.array(libraryBlockSchema), title: z.string() });
const postedSchema = z.object({ data: z.json(), type: z.string() });
const actionSchema = z.object({
  actionId: z.enum(ACTIONS),
  args: z.array(z.json()),
  uid: z.string(),
});
// what `expo export` wrote, the DOM component's page among its files
const metadataSchema = z.object({
  fileMetadata: z.object({
    ios: z.object({ assets: z.array(z.object({ ext: z.string(), path: z.string() })) }),
  }),
});

// react-native-webview as the page meets it: the object Expo injects, read before the bundle
// runs, and a postMessage whose messages wait for the native end to read them. Beside them, each
// socket the page opens and each load its policy refuses.
const nativeScript = (props: PageProps): string => `(() => {
  const posted = [];
  const sockets = [];
  const refused = [];
  window.__native = { posted, refused, sockets };
  window.ReactNativeWebView = {
    injectedObjectJson: () => ${JSON.stringify(
      JSON.stringify({ EXPO_DOM_HOST_OS: "ios", initialProps: { names: ACTIONS, props } }),
    )},
    postMessage: (message) => {
      posted.push(message);
    },
  };
  const Socket = window.WebSocket;
  window.WebSocket = class extends Socket {
    constructor(url, protocols) {
      super(url, protocols);
      sockets.push(String(url));
    }
  };
  document.addEventListener(
    "securitypolicyviolation",
    (event) => {
      refused.push(event.blockedURI + " (" + event.effectiveDirective + ")");
    },
    true,
  );
})();
`;

// a screenshot pasted into the note's text as the browser hands one over: a file, and no markup
const PASTE_PICTURE = `(() => {
  const editable = document.querySelector(${JSON.stringify(EDITOR)});
  if (!editable) return "missing";
  const bytes = Uint8Array.from(atob(${JSON.stringify(PIXEL_BASE64)}), (c) => c.codePointAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], "heron.png", { type: "image/png" }));
  editable.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  return "pasted";
})()`;

// the pasted picture as the page drew it: from an object URL of its own, decoded
const BLOB_PICTURE_WIDTH = `(() => {
  const img = [...document.querySelectorAll(${JSON.stringify(`${EDITOR} img`)})].find((el) => el.src.startsWith("blob:"));
  return img === undefined ? -1 : img.complete ? img.naturalWidth : 0;
})()`;

const LOADED_FACES = `JSON.stringify([...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "")))`;

const editable = `document.querySelector(${JSON.stringify(EDITOR)})?.getAttribute("contenteditable")`;

const evalString = async (browser: AgentBrowser, script: string): Promise<string> =>
  parseEval(await browser(["eval", `String(${script})`]), z.string());

const untilTrue = async (browser: AgentBrowser, script: string, what: string): Promise<void> => {
  await pollUntil(
    async () => await evalString(browser, script),
    (value) => value === "true",
    {
      deadlineMs: DEADLINE_MS,
      describe: (value) => `${what} (it read ${value})`,
    },
  );
};

// what the page threw and never caught, as agent-browser's JSON names it: its plain output drops
// the text of an error with no url
const pageErrorsSchema = z.object({
  data: z.object({ errors: z.array(z.object({ text: z.string() })) }),
});
const pageErrors = async (page: AgentBrowser): Promise<string[]> =>
  pageErrorsSchema
    .parse(JSON.parse(await page(["--json", "errors"])))
    .data.errors.map(({ text }) => text);

// a page that dies at boot draws nothing, so its failure carries what the page threw
const untilBooted = async (page: AgentBrowser): Promise<void> => {
  try {
    await untilTrue(
      page,
      `document.querySelector(${JSON.stringify(EDITOR)}) !== null`,
      "the editor never mounted",
    );
  } catch (error) {
    const thrown = await pageErrors(page);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; the page threw ${JSON.stringify(thrown)}`,
      { cause: error },
    );
  }
};

const editorText = async (browser: AgentBrowser): Promise<string> =>
  await evalString(browser, `document.querySelector(${JSON.stringify(EDITOR)})?.textContent ?? ""`);

const untilShows = async (browser: AgentBrowser, text: string, where: string): Promise<void> => {
  await pollUntil(
    async () => await editorText(browser),
    (shown) => shown.includes(text),
    {
      deadlineMs: DEADLINE_MS,
      describe: (shown) => `${where} never showed "${text}"; it holds:\n${shown}`,
    },
  );
};

const socketsOpened = async (browser: AgentBrowser): Promise<string[]> =>
  parseEval(
    await browser(["eval", "JSON.stringify(window.__native.sockets)"]),
    z.array(z.string()),
  );

// the one page the export holds, by its manifest
const exportedPage = async (repoRoot: string): Promise<string> => {
  const mobile = path.join(repoRoot, "apps", "mobile");
  const metadata = metadataSchema.parse(
    JSON.parse(await readFile(path.join(mobile, "dist", "metadata.json"), "utf-8")),
  );
  const [page, ...others] = metadata.fileMetadata.ios.assets.filter(({ ext }) => ext === "html");
  expect(
    page !== undefined && others.length === 0,
    `the export holds one DOM page, not ${JSON.stringify([page, ...others])}`,
  );
  return pathToFileURL(path.join(mobile, "dist", page.path)).href;
};

const noteBlocks = (otherId: string): LibraryBlock[] => [
  { children: [{ text: FIRST_LINE }], id: "p1", type: "p" },
  { children: [{ text: "" }], id: "e1", texExpression: "E = mc^2", type: "equation" },
  { children: [{ text: SECOND_LINE }], id: "p2", type: "p" },
  {
    children: [
      { text: "See " },
      { children: [{ text: "" }], key: otherId, type: "mention", value: "Old name" },
      { text: "." },
    ],
    id: "p3",
    type: "p",
  },
  { children: [{ text: "" }], id: "i1", type: "img", url: WEB_IMAGE },
];

type Json = z.infer<ReturnType<typeof z.json>>;
type NoteState = z.infer<typeof noteStateSchema>;
type Settled = z.infer<typeof settledSchema>;
type LibraryActions = ReturnType<typeof noteActions>;
// what an action answers, which JSON carries into the page
type ActionAnswer = Awaited<ReturnType<LibraryActions[keyof LibraryActions]>> | null;
// an action's reply as webview-wrapper sends it: the answer, or a refusal's message
type ActionReply = { readonly actionId: ActionId; readonly uid: string } & (
  | { readonly result: ActionAnswer }
  | { readonly error: { readonly message: string } }
);

interface NativeEnd {
  // every action the page asked, in order
  readonly asked: readonly ActionId[];
  readonly states: readonly NoteState[];
  readonly settled: readonly Settled[];
  // native renders with these props changed, and sends them all again
  readonly render: (changed: Partial<PageProps>) => Promise<void>;
  // what went wrong answering the page, which no poll would name
  readonly failures: readonly string[];
  readonly stop: () => Promise<void>;
}

const nativeEnd = (page: AgentBrowser, actions: LibraryActions, first: PageProps): NativeEnd => {
  let props = first;
  const asked: ActionId[] = [];
  const states: NoteState[] = [];
  const settled: Settled[] = [];
  const failures: string[] = [];
  const answering: Promise<void>[] = [];

  // as webview-wrapper's emit injects it (expo/src/dom/injection.ts)
  const emit = async (detail: { readonly type: string; readonly data: unknown }): Promise<void> => {
    await page([
      "eval",
      `window.dispatchEvent(new CustomEvent("$$dom_event", ${JSON.stringify({ detail })})); "sent"`,
    ]);
  };
  const sendProps = async (): Promise<void> => {
    await emit({ data: { names: ACTIONS, props }, type: "$$props" });
  };

  const run = async (actionId: ActionId, args: readonly Json[]): Promise<ActionAnswer> => {
    switch (actionId) {
      case "socketTicket": {
        return await actions.socketTicket();
      }
      case "readItem": {
        return await actions.readItem(z.string().parse(args[0]));
      }
      case "linkTargets": {
        return await actions.linkTargets();
      }
      case "readFile": {
        return await actions.readFile(z.string().parse(args[0]));
      }
      case "keepFile": {
        return await actions.keepFile(fileSchema.parse(args[0]));
      }
      case "createNote": {
        return await actions.createNote(newNoteSchema.parse(args[0]));
      }
      case "openItem": {
        actions.openItem(z.string().parse(args[0]));
        return null;
      }
      case "noteState": {
        states.push(noteStateSchema.parse(args[0]));
        return null;
      }
      case "settled": {
        settled.push(settledSchema.parse(args[0]));
        return null;
      }
      // no default
    }
  };

  // a refusal goes as webview-wrapper's serializeError hands it over: the page rejects with its
  // message
  const replyTo = async (data: Json): Promise<ActionReply> => {
    const { actionId, args, uid } = actionSchema.parse(data);
    asked.push(actionId);
    try {
      return { actionId, result: await run(actionId, args), uid };
    } catch (error) {
      return {
        actionId,
        error: { message: error instanceof Error ? error.message : String(error) },
        uid,
      };
    }
  };

  const take = async (raw: string): Promise<void> => {
    try {
      const { data, type } = postedSchema.parse(JSON.parse(raw));
      if (type === "$$dom_ready") {
        // the props the page missed while it loaded, as webview-wrapper sends them again
        await sendProps();
      } else if (type === "$$native_action") {
        await emit({ data: await replyTo(data), type: "$$native_action_result" });
      }
    } catch (error) {
      failures.push(`${raw}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // answered beside each other, as native answers each action as it comes
  const read = async (): Promise<void> => {
    const posted = parseEval(
      await page([
        "eval",
        "JSON.stringify(window.__native ? window.__native.posted.splice(0) : [])",
      ]),
      z.array(z.string()),
    );
    answering.push(...posted.map(take));
  };

  const pumping = { on: true };
  const pump = (async () => {
    while (pumping.on) {
      try {
        await read();
      } catch (error) {
        failures.push(
          `reading the page: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await delay(PUMP_EVERY_MS);
    }
  })();

  return {
    asked,
    failures,
    render: async (changed) => {
      props = { ...props, ...changed };
      await sendProps();
    },
    settled,
    states,
    stop: async () => {
      pumping.on = false;
      await pump;
      await Promise.all(answering);
    },
  };
};

export const phoneNoteEditor: Scenario = {
  description:
    "the phone's note page as `expo export` ships it, loaded from file:// at 390×844 with the scenario as its native end, answering every action with the phone's own note actions over a phone signed in to a booted Worker: it boots with no page error and draws a KaTeX equation in Inter and KaTeX's own faces at 16px or more; it dials the note's socket at the origin it was handed on a ticket it asked for, its typing reaches the library and a library tab's typing shows in it live; a leave's ask after typing is answered that the note holds; a pasted picture is kept by its sha and drawn from a blob; a page link opens its item by id; a web image is drawn as a card and never requested; and offline it turns read-only under Needs a connection, then redials and takes typing once back",
  name: "phone-note-editor",
  timeoutMs: BUILD_TIMEOUT_MS + WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    // built through turbo, not looked for on disk: a present dist/ may be last week's export
    await turboBuildOnce({
      filter: "@repo/mobile",
      onLog: ctx.log,
      repoRoot: ctx.repoRoot,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const pageUrl = await exportedPage(ctx.repoRoot);

    let itemId = "";
    let otherId = "";
    const mac = await openLibraryTab(ctx, "mac", {
      path: () => `?item=${itemId}`,
      ready: EDITOR,
      seed: async (library) => {
        const other = await library.items.createNote({
          markdown: "High water at noon.\n",
          title: OTHER_TITLE,
        });
        otherId = other.item.id;
        itemId = newItemId();
        await library.items.create({
          blocks: noteBlocks(otherId).map((block) => ({ block, section: "note" })),
          folderId: null,
          id: itemId,
          opId: crypto.randomUUID(),
          savedAt: Date.now(),
          tags: [],
          title: "Field notes",
        });
      },
    });
    const cloud = await ctx.cloudLink(mac.worker);
    const phone = await signedInPhone(mac.worker.origin);
    const opened: string[] = [];
    const actions = noteActions({
      itemId,
      library: libraryOf(phone),
      openItem: (id) => {
        opened.push(id);
      },
      queryClient: phone.runtime.queryClient,
    });
    const props: PageProps = {
      cloudOrigin: cloud.origin,
      focus: false,
      itemId,
      moved: { ids: [], seq: 0 },
      offline: false,
      settle: 0,
    };
    const script = path.join(ctx.scratchDir, "native.js");
    await writeFile(script, nativeScript(props));
    const page = await ctx.browser("page", { launchFlags: ["--init-script", script] });
    await page(["set", "viewport", "390", "844"]);
    const native = nativeEnd(page, actions, props);
    const cloudHost = new URL(cloud.origin).host;

    try {
      ctx.log(`opening ${pageUrl}`);
      await page(["open", pageUrl]);

      ctx.log("(a) the page boots with no error; (b) it draws KaTeX in its own faces");
      await untilBooted(page);
      await untilTrue(
        page,
        `document.querySelector(${JSON.stringify(`${EDITOR} .katex`)}) !== null`,
        "the equation never drew in KaTeX",
      );
      await pollUntil(
        async () => parseEval(await page(["eval", LOADED_FACES]), z.array(z.string())),
        (faces) => faces.includes("Inter Variable") && faces.includes("KaTeX_Main"),
        {
          deadlineMs: DEADLINE_MS,
          describe: (faces) =>
            `Inter Variable and KaTeX_Main never both loaded: ${JSON.stringify(faces)}`,
        },
      );
      const size = await evalString(
        page,
        `getComputedStyle(document.querySelector(${JSON.stringify(EDITOR)})).getPropertyValue("--editor-size").trim()`,
      );
      const px = /^(?<px>\d+(?:\.\d+)?)px$/u.exec(size)?.groups?.px;
      expect(
        px !== undefined && Number(px) >= 16,
        `the editor's --editor-size is ${size}, under 16px`,
      );
      expectEq(await pageErrors(page), [], "the page's errors once it drew");

      ctx.log(
        "(c) the note's socket dials the origin the page was handed, on a ticket it asked for",
      );
      await untilShows(page, SECOND_LINE, "the page");
      expect(
        native.asked.includes("socketTicket"),
        `the page never asked for a ticket: ${JSON.stringify(native.asked)}`,
      );
      const sockets = await socketsOpened(page);
      expect(
        sockets.length > 0 && sockets.every((url) => new URL(url).host === cloudHost),
        `the page's sockets went elsewhere than ${cloudHost}: ${JSON.stringify(sockets)}`,
      );
      ctx.log(
        "(c) what the page types reaches the library, and the library tab's typing shows live",
      );
      await caretToEndOf(page, FIRST_LINE);
      await page(["keyboard", "type", FROM_PHONE]);
      await untilItemText(
        mac.library,
        itemId,
        (markdown) => markdown.includes(`${FIRST_LINE}${FROM_PHONE}`),
        "the page's typing never reached the library",
      );
      await caretToEndOf(mac.browser, SECOND_LINE);
      await mac.browser(["keyboard", "type", FROM_MAC]);
      await untilShows(page, `${SECOND_LINE}${FROM_MAC}`, "the page");

      ctx.log(
        "(g) the note says it is being edited, and a leave's ask after typing hears it holds",
      );
      await pollUntil(
        async () => await Promise.resolve([...native.states]),
        (states) => states.includes("editing"),
        {
          deadlineMs: DEADLINE_MS,
          describe: (states) => `the note never said editing: ${JSON.stringify(states)}`,
        },
      );
      await native.render({ settle: 1 });
      await pollUntil(
        async () => await Promise.resolve([...native.settled]),
        (answers) => answers.length > 0,
        { deadlineMs: DEADLINE_MS, describe: () => "the leave's ask was never answered" },
      );
      expectEq(native.settled, [{ ask: 1, holds: true }], "the page's answer to the leave's ask");

      ctx.log(
        "(e) a pasted picture is kept through the phone, lands by its sha and draws from a blob",
      );
      await caretToEndOf(page, `${FIRST_LINE}${FROM_PHONE}`);
      expectEq(
        parseEval(await page(["eval", PASTE_PICTURE]), z.string()),
        "pasted",
        "the paste into the page's editor",
      );
      await untilItemText(
        mac.library,
        itemId,
        (markdown) => markdown.includes(`assets/${PIXEL_SHA}`),
        "the note never named the pasted picture by its sha",
      );
      expect(
        native.asked.includes("keepFile"),
        `the picture never went through keepFile: ${JSON.stringify(native.asked)}`,
      );
      await pollUntil(
        async () => await evalString(page, BLOB_PICTURE_WIDTH),
        (width) => width === "1",
        {
          deadlineMs: DEADLINE_MS,
          describe: (width) => `the pasted picture never drew from a blob: ${width}`,
        },
      );

      ctx.log("(f) a page link shows its item's title, and a tap opens that item by its id");
      await untilShows(page, OTHER_TITLE, "the page's link");
      await page(["find", "role", "button", "click", "--name", OTHER_TITLE, "--exact"]);
      await pollUntil(
        async () => await Promise.resolve([...opened]),
        (ids) => ids.length > 0,
        { deadlineMs: DEADLINE_MS, describe: () => "the link's tap never asked to open an item" },
      );
      expectEq(opened, [otherId], "the items the link's tap opened");

      ctx.log("(h) a web image draws as a card and is never requested");
      const drawn = await editorText(page);
      expect(drawn.includes(WEB_IMAGE), `the web image never drew as its card:\n${drawn}`);
      expectEq(
        await evalString(
          page,
          `[...document.images].filter((img) => img.src.includes(${JSON.stringify(WEB_IMAGE_HOST)})).length`,
        ),
        "0",
        "pictures drawn from the web",
      );
      const requests = await page(["network", "requests"]);
      expect(
        requests.includes(path.basename(new URL(pageUrl).pathname)),
        `the network log never saw the page itself load:\n${requests}`,
      );
      expect(
        !requests.includes(WEB_IMAGE_HOST),
        `the page asked the web for the image:\n${requests}`,
      );
      const refused = parseEval(
        await page(["eval", "JSON.stringify(window.__native.refused)"]),
        z.array(z.string()),
      );
      expect(
        !refused.some((load) => load.includes(WEB_IMAGE_HOST)),
        `the page tried to load the web image: ${JSON.stringify(refused)}`,
      );

      ctx.log("(d) with no connection the note reads only, under Needs a connection");
      await cloud.cut();
      await native.render({ offline: true });
      await untilTrue(page, `${editable} === "false"`, "the note still took edits offline");
      await untilTrue(
        page,
        `document.body.innerText.includes(${JSON.stringify(NEEDS_CONNECTION)})`,
        "the page never said it needs a connection",
      );
      ctx.log("(d) back online it redials, and what it types reaches the library");
      await cloud.restore();
      await native.render({ offline: false });
      await untilTrue(page, `${editable} === "true"`, "the note never took edits again");
      await caretToEndOf(page, `${SECOND_LINE}${FROM_MAC}`);
      await page(["keyboard", "type", AFTER_OFFLINE]);
      await untilItemText(
        mac.library,
        itemId,
        (markdown) => markdown.includes(`${SECOND_LINE}${FROM_MAC}${AFTER_OFFLINE}`),
        "the typing after the connection came back never reached the library",
      );
      const redialed = await socketsOpened(page);
      expect(
        redialed.length > sockets.length &&
          redialed.every((url) => new URL(url).host === cloudHost),
        `the page never redialed ${cloudHost}: ${JSON.stringify(redialed)}`,
      );
      expectEq(native.failures, [], "what went wrong answering the page");
      expectEq(await pageErrors(page), [], "the page's errors over the whole run");
      ctx.log(
        `the page asked ${[...new Set(native.asked)].join(", ")} and opened ${String(redialed.length)} socket(s)`,
      );
    } finally {
      await native.stop();
    }
  },
};
