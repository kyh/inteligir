// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { ElementApi, KEYS, TextApi, createSlateEditor } from "platejs";
import type { TElement, TText, Value } from "platejs";
import { PlateStatic, SlateElement } from "platejs/static";
import type { SlateElementProps } from "platejs/static";

import { cn } from "@repo/ui/lib/cn";

import { getEditorHostIo, vaultChangeTouches } from "@repo/editor/host-io";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { classNameSlateElement } from "@repo/editor/kits/kit-utils";
import { TABLE_CELL_CLASS, TABLE_HEADER_CELL_CLASS } from "@repo/editor/kits/table-kit";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { stringProp } from "@repo/editor/node-props";
import { CALLOUT_ALERT } from "@repo/editor/style-hooks";
import { alertMarkerPrefix, alertPresentation } from "@repo/editor/nodes/blockquote-node";
import type { AlertVariant } from "@repo/editor/nodes/blockquote-node";
import { decideTransclusion, nestedScope } from "@repo/editor/transclusion-guard";
import type { TransclusionScope } from "@repo/editor/transclusion-guard";
import WikiChip, { wikiChipLabel } from "@repo/editor/wiki-chip";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { useVaultActions, useWikiResolver } from "@repo/editor/host";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

const TransclusionScopeContext = createContext<TransclusionScope | null>(null);

const EmbedChip = ({ body, note }: { body: string; note?: string | undefined }) => (
  <span className="inline-flex items-baseline gap-0.5">
    <span className="font-semibold text-primary/50 select-none" contentEditable={false}>
      !
    </span>
    <WikiChip body={body} />
    {note !== undefined && (
      <span className="ml-1 text-xs text-muted-foreground italic" contentEditable={false}>
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
      attributes={{ ...props.attributes, href: url, rel: "noreferrer", target: "_blank" }}
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
      <a href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
      {props.children}
    </SlateElement>
  );
};

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

const ALERT_VARIANTS_SET = new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);

const isAlertVariant = (value: string): value is AlertVariant => ALERT_VARIANTS_SET.has(value);

const alertLeaf = (quote: TElement): TText | null => {
  const [first] = quote.children;
  if (!ElementApi.isElement(first) || first.type !== KEYS.p) {
    return null;
  }
  const [leaf] = first.children;
  return TextApi.isText(leaf) ? leaf : null;
};

const BlockquoteStatic = (props: SlateElementProps) => {
  const variant = stringProp(props.element, ALERT_VARIANT_KEY);
  const presentation =
    variant !== undefined && isAlertVariant(variant) ? alertPresentation(variant) : null;
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
          "flex items-center gap-1.5 py-[3px] text-[13px] leading-[1.3] font-semibold select-none",
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

const STATIC_COMPONENTS = new Map<string, (props: SlateElementProps) => ReactNode>([
  ["a", LinkStatic],
  ["date", DateStatic],
  ["equation", EquationStatic],
  ["inline_equation", InlineEquationStatic],
  ["video", MediaStatic],
  ["media_embed", MediaStatic],
  ["file", MediaStatic],
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
    return <span className="text-sm text-muted-foreground italic">This note is empty.</span>;
  }
  if (!editor) {
    return <pre className="whitespace-pre-wrap">{content}</pre>;
  }
  return <PlateStatic editor={editor} />;
};

const Transclusion = ({ body }: { body: string }) => {
  const { resolveWikiTarget } = useWikiResolver();
  const { openFile } = useVaultActions();
  const hostPath = useOpenNote((s) => s.editor.path);
  const scope = useContext(TransclusionScopeContext);
  const parsed = parseWikiBody(body);
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target);
  const content = useTargetContent(resolved);

  const effectiveScope: TransclusionScope = useMemo(
    () =>
      scope ?? {
        chain: hostPath === null ? [] : [hostPath],
        depth: 0,
      },
    [scope, hostPath],
  );
  const innerScope = useMemo(
    () => (resolved === null ? null : nestedScope(effectiveScope, resolved)),
    [effectiveScope, resolved],
  );

  const decision = decideTransclusion(effectiveScope, resolved);
  if (decision.kind === "chip") {
    return <EmbedChip body={body} note={decision.reason === "cycle" ? "circular" : undefined} />;
  }
  if (content.status === "missing") {
    return <EmbedChip body={body} />;
  }

  const target = decision.path;
  const title = wikiChipLabel(body);
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
          className="cursor-pointer truncate text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          {title}
        </button>
      </span>
      <span className="block overflow-x-auto px-3 py-2">
        {content.status === "loading" || innerScope === null ? (
          <span className="text-muted-foreground italic">Loading…</span>
        ) : (
          <TransclusionScopeContext value={innerScope}>
            <TransclusionBody content={content.content} />
          </TransclusionScopeContext>
        )}
      </span>
    </span>
  );
};

export default Transclusion;
