// What the codec's suites hold markdown to: a read keeps what blocks mean, never the bytes, and a
// write is its own fixpoint. Two values mean the same once ids are gone, a run of leaves with one
// set of marks is one leaf, an empty leaf beside another is nothing, and an empty caption is none.

import { ElementApi, TextApi } from "platejs";
import type { Descendant, TElement, TText } from "platejs";
import { z } from "zod";

import { canonicalJson } from "@repo/contract/library/canonical-json";

import { headlessEditor, parseMarkdown, serializeNote } from "../markdown/markdown-doc";

const markKey = (text: TText): string =>
  JSON.stringify(
    Object.keys(text)
      .filter((key) => key !== "text")
      .toSorted()
      .map((key) => [key, text[key]]),
  );

const emptyCaption = z.array(z.looseObject({ text: z.literal("") }));

const meaningOfNodes = (nodes: readonly Descendant[]): Descendant[] => {
  const merged: Descendant[] = [];
  for (const node of nodes) {
    if (ElementApi.isElement(node)) {
      const { id: _id, caption, ...rest } = node;
      // a prop a rule left undefined is no prop, as JSON has it
      const defined = Object.entries(rest).filter(([, value]) => value !== undefined);
      const element: TElement = {
        ...Object.fromEntries(defined),
        children: meaningOfNodes(node.children),
        type: node.type,
      };
      merged.push(
        caption === undefined || emptyCaption.safeParse(caption).success
          ? element
          : { ...element, caption },
      );
      continue;
    }
    const last = merged.at(-1);
    if (last !== undefined && TextApi.isText(last) && markKey(last) === markKey(node)) {
      merged[merged.length - 1] = { ...last, text: last.text + node.text };
    } else {
      merged.push({ ...node });
    }
  }
  const kept = merged.filter((node) => !TextApi.isText(node) || node.text !== "");
  return kept.length > 0 ? kept : [{ text: "" }];
};

// a value's meaning as one string, so a suite compares two by equality
/** @internal */
export const meaningOf = (nodes: readonly Descendant[]): string =>
  canonicalJson(z.json().parse(meaningOfNodes(nodes)));

// markdown read into blocks; a refusal throws, since a suite that meant a refusal asks md-read
/** @internal */
export const readValue = (md: string): TElement[] => {
  const read = parseMarkdown(md);
  if (!read.ok) {
    throw new Error(`the markdown did not read: ${read.reason.kind}`);
  }
  return read.value;
};

/** @internal */
export const writeValue = (value: readonly TElement[]): string =>
  serializeNote(headlessEditor(), structuredClone([...value]));

// markdown read and written again, which a written file is the fixpoint of
/** @internal */
export const rewrite = (md: string): string => writeValue(readValue(md));
