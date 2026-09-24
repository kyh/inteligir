// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { getLinkAttributes } from "@platejs/link";
import { ElementApi, KEYS, TextApi, createSlateEditor } from "platejs";
import type { TElement, TText, Value } from "platejs";
import { PlateStatic, SlateElement } from "platejs/static";
import type { SlateElementProps } from "platejs/static";

import { cn } from "@repo/ui/lib/cn";

import { getEditorHostIo, vaultChangeTouches } from "@repo/editor/host-io";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { classNameSlateElement } from "@repo/editor/kits/kit-utils";
import { TABLE_CELL_CLASS, TABLE_HEADER_CELL_CLASS } from "@repo/editor/kits/table-kit";
import { isHttpUrl } from "@repo/editor/lib/wire";
import { alertMarkerPrefix, parseAlertVariant } from "@repo/editor/markdown/alert-marker";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { stringProp } from "@repo/editor/node-props";
import { CALLOUT_ALERT } from "@repo/editor/style-hooks";
import { alertPresentation } from "@repo/editor/nodes/blockquote-node";
import { ImageFigure } from "@repo/editor/nodes/image-node";
import { RichBlockCard } from "@repo/editor/nodes/rich-block-chrome";
import { decideTransclusion } from "@repo/editor/transclusion-guard";
import WikiChip from "@repo/editor/wiki-chip";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { useLinkResolver, useVaultActions } from "@repo/editor/host";
import { parseWikiBody, wikiLinkLabel } from "@repo/notes/markdown/remark-wiki-link";

// The note an embed shows: a url inside it is relative to that note, not to the open one.
const EmbeddedNotePathContext = createContext<string | null>(null);

const EmbedChip = ({ body, note }: { body: string; note?: string | undefined }) => (
  <span className="inline-flex items-baseline gap-0.5">
    <span className="font-semibold text-primary/50 select-none" contentEditable={false}>
      !
    </span>
    <WikiChip body={body} />
    {note !== undefined && (
      <span className="ml-1 text-body text-muted-foreground italic" contentEditable={false}>
        ({note})
      </span>
    )}
  </span>
);

const LinkStatic = (props: SlateElementProps) => {
  const url = stringProp(props.element, "url") ?? "";
  return (
    <SlateElement
      {...props}
      as="a"
      attributes={{
        ...props.attributes,
        ...getLinkAttributes(props.editor, {
          children: props.element.children,
          type: props.element.type,
          url,
        }),
        rel: "noreferrer",
        target: "_blank",
      }}
    >
      {props.children}
    </SlateElement>
  );
};

const WikiLinkStatic = (props: SlateElementProps) => {
  const body = stringProp(props.element, "body") ?? "";
  return (
    <SlateElement {...props} as="span">
      <WikiChip body={body} />
      {props.children}
    </SlateElement>
  );
};

// The nesting stop: an embed inside embedded content stays a chip, so no chain of notes recurses.
const WikiEmbedStatic = (props: SlateElementProps) => {
  const body = stringProp(props.element, "body") ?? "";
  return (
    <SlateElement {...props} as="span">
      <EmbedChip body={body} />
      {props.children}
    </SlateElement>
  );
};

const DateStatic = (props: SlateElementProps) => {
  const date = stringProp(props.element, "date") ?? "";
  return (
    <SlateElement {...props} as="span" className="rounded-sm bg-muted px-1 text-muted-foreground">
      {date || "date"}
      {props.children}
    </SlateElement>
  );
};

const EquationStatic = (props: SlateElementProps) => {
  const tex = stringProp(props.element, "texExpression") ?? "";
  return (
    <SlateElement {...props} className="my-1">
      <code>{tex}</code>
      {props.children}
    </SlateElement>
  );
};

const InlineEquationStatic = (props: SlateElementProps) => {
  const tex = stringProp(props.element, "texExpression") ?? "";
  return (
    <SlateElement {...props} as="span">
      <code>{tex}</code>
      {props.children}
    </SlateElement>
  );
};

const MediaStatic = (props: SlateElementProps) => {
  const url = stringProp(props.element, "url") ?? "";
  return (
    <SlateElement {...props} className="my-1">
      <a href={isHttpUrl(url) ? url : undefined} target="_blank" rel="noreferrer">
        {url}
      </a>
      {props.children}
    </SlateElement>
  );
};

const ImageStatic = (props: SlateElementProps) => {
  const notePath = useContext(EmbeddedNotePathContext);
  return (
    <SlateElement {...props} className="py-2.5">
      <ImageFigure element={props.element} notePath={notePath} selected={false} />
      {props.children}
    </SlateElement>
  );
};

const FormulaPillStatic = (props: SlateElementProps) => {
  const source = stringProp(props.element, "source") ?? "";
  const display = stringProp(props.element, "display") ?? "";
  return (
    <SlateElement {...props} as="span">
      <span
        title={source}
        className="rounded-sm bg-accent px-1 font-medium text-accent-foreground tabular-nums"
      >
        {display === "" ? source : display}
      </span>
      {props.children}
    </SlateElement>
  );
};

// an interactive block cannot run in a static render; the card says what is there instead.
const richBlockStatic = (label: string) =>
  function RichBlockStatic(props: SlateElementProps) {
    return (
      <SlateElement {...props}>
        <RichBlockCard label={label}>
          <span className="block px-3 py-2 text-muted-foreground italic">
            Open the note to see this block.
          </span>
        </RichBlockCard>
        {props.children}
      </SlateElement>
    );
  };

const OpaqueBlockStatic = (props: SlateElementProps) => (
  <SlateElement {...props} className="my-1">
    <pre className="overflow-x-auto whitespace-pre text-muted-foreground">
      {stringProp(props.element, "value") ?? ""}
    </pre>
    {props.children}
  </SlateElement>
);

const OpaqueInlineStatic = (props: SlateElementProps) => (
  <SlateElement {...props} as="span">
    <code className="text-muted-foreground">{stringProp(props.element, "value") ?? ""}</code>
    {props.children}
  </SlateElement>
);

// the plugin's own tag is <hr>, which cannot hold the void's spacer child and throws.
const HrStatic = (props: SlateElementProps) => (
  <SlateElement {...props} className="py-2">
    <div>
      <hr className="my-0" />
    </div>
    {props.children}
  </SlateElement>
);

// renders no text, as live; inline, because the default <div> would break the line it sits in.
const CommentMarkerStatic = (props: SlateElementProps) => <SlateElement {...props} as="span" />;

const FrontmatterStatic = (props: SlateElementProps) => (
  <SlateElement {...props} className="hidden">
    {props.children}
  </SlateElement>
);

// the default static renderer is a bare <div> per node, which flattens a table into stacked lines.
const TableStatic = (props: SlateElementProps) => (
  <SlateElement {...props} as="table" className="my-1">
    <tbody>{props.children}</tbody>
  </SlateElement>
);

const TableRowStatic = (props: SlateElementProps) => <SlateElement {...props} as="tr" />;

// PlateStatic runs no decorations, so the `> [!TIP]` marker the live editor hides behind the
// badge would render literally; stripAlertMarkers removes it from this throwaway render copy
// instead. never reuse it on an editable path: it deletes bytes.
export const ALERT_VARIANT_KEY = "transclusionAlertVariant";

const alertLeaf = (quote: TElement): TText | null => {
  const [first] = quote.children;
  if (!ElementApi.isElement(first) || first.type !== KEYS.p) {
    return null;
  }
  const [leaf] = first.children;
  return TextApi.isText(leaf) ? leaf : null;
};

const BlockquoteStatic = (props: SlateElementProps) => {
  const variant = parseAlertVariant(stringProp(props.element, ALERT_VARIANT_KEY) ?? "");
  const presentation = variant === null ? null : alertPresentation(variant);
  if (!presentation) {
    return (
      <SlateElement {...props} as="blockquote">
        {props.children}
      </SlateElement>
    );
  }
  const { Icon, accent, icon, label } = presentation;
  return (
    <SlateElement
      {...props}
      as="blockquote"
      className={cn(CALLOUT_ALERT, "rounded-md border-l-[3px] py-2 pr-3 pl-4 [&>*]:my-0", accent)}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 py-[3px] text-subtitle leading-[1.3] font-semibold select-none",
          icon,
        )}
        contentEditable={false}
      >
        <Icon className="size-4" />
        {label}
      </div>
      {props.children}
    </SlateElement>
  );
};

// Every void needs a row: the default static element is a <div> or the plugin's own tag, which
// draws the void empty, or throws for <hr>. __tests__/transclusion-static.test.ts pins it.
export const STATIC_COMPONENTS: ReadonlyMap<string, (props: SlateElementProps) => ReactNode> =
  new Map([
    ["a", LinkStatic],
    ["date", DateStatic],
    ["equation", EquationStatic],
    ["inline_equation", InlineEquationStatic],
    ["video", MediaStatic],
    ["media_embed", MediaStatic],
    ["file", MediaStatic],
    ["img", ImageStatic],
    ["hr", HrStatic],
    ["formulaPill", FormulaPillStatic],
    ["commentMarker", CommentMarkerStatic],
    ["chart_block", richBlockStatic("chart")],
    ["canvas_block", richBlockStatic("canvas")],
    ["html_block", richBlockStatic("html")],
    ["opaqueBlock", OpaqueBlockStatic],
    ["opaqueInline", OpaqueInlineStatic],
    ["frontmatter", FrontmatterStatic],
    ["table", TableStatic],
    ["tr", TableRowStatic],
    ["td", classNameSlateElement("td", TABLE_CELL_CLASS)],
    ["th", classNameSlateElement("th", TABLE_HEADER_CELL_CLASS)],
    ["wikiLink", WikiLinkStatic],
    ["wikiEmbed", WikiEmbedStatic],
    ["blockquote", BlockquoteStatic],
  ]);

const TRANSCLUSION_KIT = BASE_KIT.map((plugin) => {
  const component = STATIC_COMPONENTS.get(String(plugin.key));
  return component ? plugin.withComponent(component) : plugin;
});

export const stripAlertMarkers = (value: Value): Value =>
  value.map((node) => {
    if (!ElementApi.isElement(node) || node.type !== KEYS.blockquote) {
      return node;
    }
    const leaf = alertLeaf(node);
    const marker = leaf ? alertMarkerPrefix(leaf.text) : null;
    if (!leaf || !marker) {
      return node;
    }
    const [paragraph, ...rest] = node.children;
    if (!ElementApi.isElement(paragraph)) {
      return node;
    }
    const [, ...siblings] = paragraph.children;
    return {
      ...node,
      [ALERT_VARIANT_KEY]: marker.variant,
      children: [
        {
          ...paragraph,
          children: [{ ...leaf, text: leaf.text.slice(marker.hidden) }, ...siblings],
        },
        ...rest,
      ],
    };
  });

type TargetContent =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; content: string };

const useTargetContent = (path: string | null): TargetContent => {
  const [state, setState] = useState<TargetContent>({ status: "loading" });
  useEffect(() => {
    if (path === null) {
      return;
    }
    const bridge = getEditorHostIo();
    let live = true;
    const read = async (): Promise<void> => {
      try {
        const content = await bridge.readVaultFile({ path });
        if (!live) {
          return;
        }
        setState((prev) =>
          prev.status === "ready" && prev.content === content ? prev : { content, status: "ready" },
        );
      } catch {
        if (live) {
          setState({ status: "missing" });
        }
      }
    };
    void read();
    // only when the change touched this target: otherwise a transcluding note re-reads every
    // embed on each of its own keystrokes.
    const unsubscribe = bridge.onVaultChanged((event) => {
      if (vaultChangeTouches(event, path)) {
        void read();
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [path]);
  return state;
};

const TransclusionBody = ({ content }: { content: string }) => {
  const parsed = useMemo(() => parseMarkdown(content), [content]);
  const editor = useMemo(
    () =>
      parsed.ok
        ? createSlateEditor({
            plugins: TRANSCLUSION_KIT,
            value: stripAlertMarkers(parsed.value),
          })
        : null,
    [parsed],
  );
  if (content.trim() === "") {
    return <span className="text-subtitle text-muted-foreground italic">This note is empty.</span>;
  }
  if (!editor) {
    return <pre className="whitespace-pre-wrap">{content}</pre>;
  }
  return <PlateStatic editor={editor} />;
};

const Transclusion = ({ body }: { body: string }) => {
  const { resolveWikiTarget } = useLinkResolver();
  const { openFile } = useVaultActions();
  const hostPath = useOpenNote((s) => s.editor.path);
  const parsed = parseWikiBody(body);
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target, parsed.alias);
  const content = useTargetContent(resolved);

  const decision = decideTransclusion(hostPath, resolved);
  if (decision.kind === "chip") {
    return <EmbedChip body={body} note={decision.reason === "cycle" ? "circular" : undefined} />;
  }
  if (content.status === "missing") {
    return <EmbedChip body={body} />;
  }

  const target = decision.path;
  const title = wikiLinkLabel(body);
  const onOpen = (e: MouseEvent) => {
    e.preventDefault();
    openFile(target);
  };

  return (
    <span
      contentEditable={false}
      className={cn(
        "my-1 inline-block w-full rounded-md border border-border bg-muted/30 align-top",
      )}
    >
      <span className="flex items-center border-b border-border/60 px-3 py-1">
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer truncate text-body font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          {title}
        </button>
      </span>
      <span className="block overflow-x-auto px-3 py-2">
        {content.status === "loading" ? (
          <span className="text-muted-foreground italic">Loading…</span>
        ) : (
          <EmbeddedNotePathContext value={target}>
            <TransclusionBody content={content.content} />
          </EmbeddedNotePathContext>
        )}
      </span>
    </span>
  );
};

export default Transclusion;
