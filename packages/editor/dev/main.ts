import { createMarkdownEditor } from "../src/create-markdown-editor";
import { sampleDoc } from "./sample-doc";

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
});
editor.focus();
