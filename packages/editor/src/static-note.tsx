// An item's blocks drawn read-only, its constructs as cards and its links live: an embed's body
// draws through it. It reaches the editor host seam, so a kit file base-kit composes must never
// import it eagerly (transclusion.tsx is reached through React.lazy).

import { useMemo } from "react";
import type { ReactNode } from "react";
import { getLinkAttributes } from "@platejs/link";
import { ElementApi, KEYS, TextApi, createSlateEditor } from "platejs";
import type { TElement, TText, Value } from "platejs";
import { PlateStatic, SlateElement } from "platejs/static";
import type { SlateElementProps } from "platejs/static";

import { cn } from "@repo/ui/lib/cn";

import {
  CANVAS_BLOCK_KEY,
  CHART_BLOCK_KEY,
  ANNOTATION_MARKER_KEY,
  FORMULA_PILL_KEY,
  HTML_BLOCK_KEY,
  OPAQUE_KEY,
  WIKI_EMBED_KEY,
  WIKI_LINK_KEY,
} from "@repo/editor/dialect-node-keys";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { classNameSlateElement } from "@repo/editor/kits/kit-utils";
import { TABLE_CELL_CLASS, TABLE_HEADER_CELL_CLASS } from "@repo/editor/kits/table-kit";
import { isHttpUrl } from "@repo/editor/lib/url";
import { alertMarkerPrefix, parseAlertVariant } from "@repo/editor/markdown/alert-marker";
import { stringProp } from "@repo/editor/node-props";
import { CALLOUT_ALERT } from "@repo/editor/style-hooks";
import { alertPresentation } from "@repo/editor/nodes/blockquote-node";
import { FileCard } from "@repo/editor/nodes/file-card";
import { ImageFigure } from "@repo/editor/nodes/image-node";
import { LibraryVideo } from "@repo/editor/nodes/remote-media-node";
import { RichBlockCard } from "@repo/editor/nodes/rich-block-chrome";
import WikiChip from "@repo/editor/wiki/wiki-chip";
import { wikiFieldsOf } from "@repo/editor/wiki/wiki-node";
import type { WikiNodeFields } from "@repo/editor/wiki/wiki-node";

export const EmbedChip = ({ link, note }: { link: WikiNodeFields; note?: string | undefined }) => (
  <span className="inline-flex items-baseline gap-0.5">
    <span className="font-semibold text-primary/50 select-none" contentEditable={false}>
      !
    </span>
    <WikiChip link={link} />
    {note !== undefined && (
      <span className="ml-1 text-body text-muted-foreground italic" contentEditable={false}>
        ({note})
      </span>
    )}
  </span>
);

// only an http(s) url is the browser's; any other url draws as text, since an item is linked by
// `[[…]]`, never by an address
const LinkStatic = (props: SlateElementProps) => {
  const url = stringProp(props.element, "url") ?? "";
  const external = isHttpUrl(url)
    ? {
        ...getLinkAttributes(props.editor, {
          children: props.element.children,
          type: props.element.type,
          url,
        }),
        rel: "noreferrer",
        target: "_blank",
      }
    : {};
  return (
    <SlateElement {...props} as="a" attributes={{ ...props.attributes, ...external }}>
      {props.children}
    </SlateElement>
  );
};

const WikiLinkStatic = (props: SlateElementProps) => {
  const link = wikiFieldsOf(props.element);
  return (
    <SlateElement {...props} as="span">
      <WikiChip link={link} />
      {props.children}
    </SlateElement>
  );
};

// The nesting stop: an embed inside embedded content stays a chip, so no chain of notes recurses.
const WikiEmbedStatic = (props: SlateElementProps) => {
  const link = wikiFieldsOf(props.element);
  return (
    <SlateElement {...props} as="span">
      <EmbedChip link={link} />
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

const ImageStatic = (props: SlateElementProps) => (
  <SlateElement {...props} className="py-2.5">
    <ImageFigure element={props.element} selected={false} />
    {props.children}
  </SlateElement>
);

// a video or a file the library holds by its sha draws as the live one does; one by its address,
// as its link
const libraryMediaStatic = (kind: "video" | "file") =>
  function LibraryMediaStatic(props: SlateElementProps) {
    const sha = stringProp(props.element, "sha") ?? null;
    if (sha === null) {
      return <MediaStatic {...props} />;
    }
    return (
      <SlateElement {...props} className="my-1">
        {kind === "video" ? (
          <LibraryVideo selected={false} sha={sha} />
        ) : (
          <FileCard name={stringProp(props.element, "name") ?? "File"} selected={false} sha={sha} />
        )}
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
            Open it to see this block.
          </span>
        </RichBlockCard>
        {props.children}
      </SlateElement>
    );
  };

const OpaqueStatic = (props: SlateElementProps) => (
  <SlateElement {...props} as="span">
    <code className="text-muted-foreground">{stringProp(props.element, "source") ?? ""}</code>
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
const AnnotationMarkerStatic = (props: SlateElementProps) => <SlateElement {...props} as="span" />;

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
/** @internal */
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
// draws the void empty, or throws for <hr>. transclusion-static.test.ts pins it.
/** @internal */
export const STATIC_COMPONENTS: ReadonlyMap<string, (props: SlateElementProps) => ReactNode> =
  new Map([
    ["a", LinkStatic],
    ["date", DateStatic],
    ["equation", EquationStatic],
    ["inline_equation", InlineEquationStatic],
    ["video", libraryMediaStatic("video")],
    ["media_embed", MediaStatic],
    ["file", libraryMediaStatic("file")],
    ["img", ImageStatic],
    ["hr", HrStatic],
    [FORMULA_PILL_KEY, FormulaPillStatic],
    [ANNOTATION_MARKER_KEY, AnnotationMarkerStatic],
    [CHART_BLOCK_KEY, richBlockStatic("chart")],
    [CANVAS_BLOCK_KEY, richBlockStatic("canvas")],
    [HTML_BLOCK_KEY, richBlockStatic("html")],
    [OPAQUE_KEY, OpaqueStatic],
    ["table", TableStatic],
    ["tr", TableRowStatic],
    ["td", classNameSlateElement("td", TABLE_CELL_CLASS)],
    ["th", classNameSlateElement("th", TABLE_HEADER_CELL_CLASS)],
    [WIKI_LINK_KEY, WikiLinkStatic],
    [WIKI_EMBED_KEY, WikiEmbedStatic],
    ["blockquote", BlockquoteStatic],
  ]);

const STATIC_KIT = BASE_KIT.map((plugin) => {
  const component = STATIC_COMPONENTS.get(String(plugin.key));
  return component ? plugin.withComponent(component) : plugin;
});

/** @internal */
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

export const StaticNote = ({ blocks }: { blocks: readonly TElement[] }) => {
  const editor = useMemo(
    () => createSlateEditor({ plugins: STATIC_KIT, value: stripAlertMarkers([...blocks]) }),
    [blocks],
  );
  if (blocks.length === 0) {
    return <span className="text-subtitle text-muted-foreground italic">This note is empty.</span>;
  }
  return <PlateStatic editor={editor} />;
};
