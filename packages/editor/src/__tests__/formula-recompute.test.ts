import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import { collectFormulas } from "@repo/notes/formulas/collect-formulas";
import { recomputeFormulas } from "@repo/editor/formulas/formula-recompute";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { stringProp } from "@repo/editor/node-props";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const editorWith = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
};

type Editor = ReturnType<typeof editorWith>;

const pills = (editor: Editor): { display: string; meta: string }[] => {
  const out: { display: string; meta: string }[] = [];
  for (const [node] of editor.api.nodes<TElement>({ at: [], match: { type: "formulaPill" } })) {
    if (ElementApi.isElement(node)) {
      out.push({
        display: stringProp(node, "display") ?? "",
        meta: stringProp(node, "meta") ?? "",
      });
    }
  }
  return out;
};

const lastPill = (editor: Editor) => pills(editor).at(-1);

// every other note, by frontmatter id, answered as the host would: its collected formulas
const hostOver = (notes: Readonly<Record<string, string>>) => {
  const asked: string[] = [];
  installFakeEditorHost({
    readNoteFormulas: async ({ noteId }) => {
      asked.push(noteId);
      const markdown = notes[noteId];
      return await Promise.resolve(
        markdown === undefined
          ? null
          : { formulas: collectFormulas(markdown), path: `${noteId}.md` },
      );
    },
  });
  return { asked };
};

// the edit and the recompute arrive on separate turns, as the settle debounce delivers them
const nextTurn = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise-native form here
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe("the recompute's display rewrite", () => {
  it("corrects a plain expression's display without adding an undo step", async () => {
    hostOver({});
    const editor = editorWith("Total {{2+2|5}}\n");

    await recomputeFormulas(editor);

    expect(lastPill(editor)?.display).toBe("4");
    expect(editor.history.undos).toHaveLength(0);
  });

  it("leaves one undo to revert the user's own edit, and one redo to bring it back", async () => {
    hostOver({});
    const editor = editorWith("Total {{2+2|5}} tail\n");
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText("!");
    await nextTurn();

    await recomputeFormulas(editor);
    expect(lastPill(editor)?.display).toBe("4");

    editor.undo();

    expect(editor.api.string([0])).not.toContain("!");
    expect(lastPill(editor)?.display).toBe("4");
    expect(editor.history.redos).toHaveLength(1);
  });
});

describe("the note a bound ref names", () => {
  it("is this note when its frontmatter id is quoted, so nothing is asked of the host", async () => {
    const { asked } = hostOver({});
    const editor = editorWith(
      [
        "---",
        "id: 'N1'",
        "---",
        "",
        "{{5|5|id=F1;name=a}} and {{@(a#N1#F1)*2|0|id=F2;name=b}}",
        "",
      ].join("\n"),
    );

    await recomputeFormulas(editor);

    expect(lastPill(editor)).toEqual({ display: "10", meta: "id=F2;name=b" });
    expect(asked).toEqual([]);
  });

  it("resolves through a chain of notes this one never names", async () => {
    const { asked } = hostOver({
      B: "{{@(c#C#fc)+1|0|id=fb;name=b}}\n",
      C: "{{40|40|id=fc;name=c}}\n",
    });
    const editor = editorWith("---\nid: A\n---\n\n{{@(b#B#fb)*2|0|id=fa;name=a}}\n");

    await recomputeFormulas(editor);

    expect(lastPill(editor)?.display).toBe("82");
    expect(asked).toEqual(["B", "C"]);
  });

  it("goes stale when its note cannot be found, keeping the last display", async () => {
    hostOver({});
    const editor = editorWith("{{@(x#GONE#fx)+1|7|id=f1}}\n");

    await recomputeFormulas(editor);

    expect(lastPill(editor)).toEqual({ display: "7", meta: "id=f1;stale=1" });
  });

  it("writes nothing when an edit lands during the read", async () => {
    const read = Promise.withResolvers<string>();
    installFakeEditorHost({
      readNoteFormulas: async () => ({
        formulas: collectFormulas(await read.promise),
        path: "b.md",
      }),
    });
    const editor = editorWith("{{@(b#B#fb)*2|0|id=fa;name=a}} tail\n");

    const pass = recomputeFormulas(editor);
    await nextTurn();
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText("!");
    read.resolve("{{21|21|id=fb;name=b}}\n");
    await pass;

    expect(lastPill(editor)).toEqual({ display: "0", meta: "id=fa;name=a" });
  });
});
