import { createMarkdownEditor } from "../src/create-markdown-editor";
import { sampleDoc } from "./sample-doc";

// The editor's palette reads `data-theme` off :root and nothing else — see the
// note in src/editor-theme.ts. This demo is the host, so it resolves the theme
// the way the app's own carrier does.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const stampTheme = (): void => {
  document.documentElement.dataset["theme"] = dark.matches ? "dark" : "light";
};
stampTheme();
dark.addEventListener("change", stampTheme);

const parent = document.querySelector("#editor");
if (!(parent instanceof HTMLElement)) {
  throw new Error("demo page is missing the #editor mount point");
}

const editor = createMarkdownEditor({
  parent,
  doc: sampleDoc,
  onDocChanged: (doc) => {
    console.debug("buffer length", doc.length);
  },
  onOpenTag: (tag) => {
    console.debug("tag clicked", tag);
  },
  // This demo's "vault" is the vite root, so a vault-relative path is a path
  // this dev server already serves. The app's own resolver points at
  // /api/v1/vault/asset instead — the seam is the point.
  resolveAsset: (src) => (src.startsWith("assets/") ? `/${src}` : null),
});
editor.focus();
