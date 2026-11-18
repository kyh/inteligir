import type { WebViewNavigation } from "react-native-webview";

export type LoadVerdict =
  | { kind: "allow" }
  | { kind: "refuse" }
  | { kind: "open-outside"; url: string };

type LoadRequest = Pick<WebViewNavigation, "navigationType" | "url"> & {
  readonly isTopFrame: boolean;
};

export const EVERY_ORIGIN = ["*"];

const isHttpUrl = (url: string) => /^https?:\/\//iu.test(url);

const isFileUrl = (url: string) => /^file:\/\//iu.test(url);

const PAGE_CHILD_FRAMES: ReadonlySet<string> = new Set(["about:blank", "about:srcdoc"]);

export const loadVerdict = (request: LoadRequest, dev: boolean) => {
  const { navigationType, url } = request;

  if (!request.isTopFrame) {
    return (
      PAGE_CHILD_FRAMES.has(url) ? { kind: "allow" } : { kind: "refuse" }
    ) satisfies LoadVerdict;
  }

  if (navigationType === "click") {
    return (
      isHttpUrl(url) ? { kind: "open-outside", url } : { kind: "refuse" }
    ) satisfies LoadVerdict;
  }

  const pageLoad = navigationType === "other" || navigationType === "reload";

  return (
    pageLoad && (isFileUrl(url) || (dev && isHttpUrl(url))) ? { kind: "allow" } : { kind: "refuse" }
  ) satisfies LoadVerdict;
};

export const openWindowVerdict = (url: string) =>
  (isHttpUrl(url) ? { kind: "open-outside", url } : { kind: "refuse" }) satisfies LoadVerdict;
