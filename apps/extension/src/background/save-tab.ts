// a tab saved: the capture script injected into it, its page read back, and the save the Mac is
// asked for. A page the browser will not script (its own pages, the Web Store, the PDF viewer) is
// saved by its address alone, and a page that is not on the web is not saved at all.

import {
  BROWSER_WIRE_VERSION,
  CAPTURE_HTML_MAX_CHARS,
  capturedPageWireSchema,
} from "@repo/contract/browser/browser-wire";
import type { BrowserSave, CapturedPageWire } from "@repo/contract/browser/browser-wire";
import type { CaptureOptions } from "../capture/serialize-page";
import { refusedOutcome } from "../messages";
import type { Outcome } from "../messages";
import { askHost } from "./ask-host";
import type { HostAnswer } from "./ask-host";
import { isWebUrl } from "./menus";

export interface TabFacts {
  id: number;
  title: string | undefined;
  url: string | undefined;
}

// null when the tab cannot be scripted, or answered something that is not a captured page
type CaptureTab = (tabId: number, options: CaptureOptions) => Promise<CapturedPageWire | null>;

const CAPTURE_SCRIPT = "capture.js";

const captureTab: CaptureTab = async (tabId, options) => {
  try {
    await chrome.scripting.executeScript({ files: [CAPTURE_SCRIPT], target: { tabId } });
    // the function crosses into the page as its source text, so it names nothing outside itself
    const [frame] = await chrome.scripting.executeScript({
      args: [options],
      func: (given: CaptureOptions) => window.inteligirCapture?.(given) ?? null,
      target: { tabId },
    });
    // the page shaped what came back, so it is read as the wire reads it
    const parsed = capturedPageWireSchema.safeParse(frame?.result);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export type SavePlan = { kind: "save"; save: BrowserSave } | { kind: "unsupported" };

export interface PlanArgs {
  tab: TabFacts;
  keepCopy: boolean;
  // Chrome's own reading of the selection a right-click named, for a page it will not script
  selectionText?: string;
  capture?: CaptureTab;
}

export const planTabSave = async (args: PlanArgs): Promise<SavePlan> => {
  const { tab } = args;
  if (!isWebUrl(tab.url)) {
    return { kind: "unsupported" };
  }
  const capture = args.capture ?? captureTab;
  const page = await capture(tab.id, {
    htmlMaxChars: CAPTURE_HTML_MAX_CHARS,
    keepCopy: args.keepCopy,
  });
  if (page !== null && isWebUrl(page.url)) {
    return { kind: "save", save: { keepCopy: args.keepCopy, page, target: "page" } };
  }
  const text = args.selectionText?.trim() ?? "";
  if (text !== "") {
    // the Mac reads the page from its address and places the highlight in what it reads
    return {
      kind: "save",
      save: {
        keepCopy: args.keepCopy,
        page: {
          html: null,
          selection: { text: text.slice(0, 20_000) },
          title: (tab.title ?? "").slice(0, 2000),
          url: tab.url,
        },
        target: "page",
      },
    };
  }
  return {
    kind: "save",
    save: {
      target: "link",
      title: tab.title?.trim() === "" ? null : (tab.title ?? null),
      url: tab.url,
    },
  };
};

export const outcomeOf = (answer: HostAnswer): Outcome => {
  switch (answer.kind) {
    case "absent": {
      return refusedOutcome("absent");
    }
    // the app's door names another extension: an app built before this extension's key
    case "forbidden": {
      return refusedOutcome("update-app", "the app's door does not name this extension");
    }
    case "crashed": {
      return refusedOutcome("failed", answer.detail);
    }
    case "reply": {
      const { reply } = answer;
      switch (reply.type) {
        case "hello": {
          return { appVersion: reply.appVersion, kind: "hello", library: reply.library };
        }
        case "saved": {
          return { created: reply.created, kind: "saved", path: reply.path, title: reply.title };
        }
        case "opened": {
          return { kind: "opened" };
        }
        case "refused": {
          return refusedOutcome(reply.reason, reply.detail);
        }
        default: {
          const exhaustive: never = reply;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = answer;
      return exhaustive;
    }
  }
};

export const saveWith = async (save: BrowserSave): Promise<Outcome> =>
  outcomeOf(await askHost({ save, type: "save", v: BROWSER_WIRE_VERSION }));

export const saveTab = async (args: PlanArgs): Promise<Outcome> => {
  const plan = await planTabSave(args);
  return plan.kind === "unsupported"
    ? refusedOutcome("unsupported-page", "only a page on the web can be saved")
    : await saveWith(plan.save);
};
