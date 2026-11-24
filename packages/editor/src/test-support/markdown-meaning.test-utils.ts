import { ElementApi, TextApi } from "platejs";
import type { Descendant, TElement, TText } from "platejs";
import { z } from "zod";

import { canonicalJson } from "@repo/contract/library/canonical-json";

import { headlessEditor, parseMarkdown, serializeNote } from "../headless/codec/markdown-doc";

const markKey = (text: TText) =>
  JSON.stringify(
    Object.keys(text)
      .filter((key) => key !== "text")
      .toSorted()
      .map((key) => [key, text[key]]),
  );

const emptyCaption = z.array(z.looseObject({ text: z.literal("") }));

const meaningOfNodes = (nodes: readonly Descendant[]) => {
  const merged: Descendant[] = [];

  for (const node of nodes) {
    if (ElementApi.isElement(node)) {
      const { id: _id, caption, ...rest } = node;
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

  return (kept.length > 0 ? kept : [{ text: "" }]) satisfies Descendant[];
};

export const meaningOf = (nodes: readonly Descendant[]) =>
  canonicalJson(z.json().parse(meaningOfNodes(nodes)));

export const readValue = (md: string) => {
  const read = parseMarkdown(md);

  if (!read.ok) {
    throw new Error(`the markdown did not read: ${read.reason.kind}`);
  }

  return read.value;
};

export const writeValue = (value: readonly TElement[]) =>
  serializeNote(headlessEditor(), structuredClone([...value]));

export const rewrite = (md: string) => writeValue(readValue(md));
