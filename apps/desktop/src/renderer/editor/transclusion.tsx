// ![[transclusion]] rendering: the embed chip expands into the target note's
// content, rendered READ-ONLY through Plate's static path over the SAME
// BASE_KIT the byte-stability gate uses — no nested live editor. Guards:
// unresolved targets render the unresolved chip, self/circular embeds render
// a chip + note, and embeds inside embedded content (depth > 1) render as
// chips. Content re-reads on every onVaultChanged so an edit to the target
// (agent or user) refreshes the card.
//
// Loaded via React.lazy from wiki-link-kit — this module reaches into
// vault-context, so an eager import from the kit file (which base-kit
// composes) would close an import cycle around the kit files.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createSlateEditor } from "platejs";
import { PlateStatic, SlateElement, type SlateElementProps } from "platejs/static";

import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@renderer/lib/bridge";
import { BASE_KIT } from "@renderer/editor/kits/base-kit";
import { classNameSlateElement } from "@renderer/editor/kits/kit-utils";
import { TABLE_CELL_CLASS, TABLE_HEADER_CELL_CLASS } from "@renderer/editor/kits/table-kit";
import { parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import {
  decideTransclusion,
  nestedScope,
  type TransclusionScope,
} from "@renderer/editor/transclusion-guard";
import WikiChip, { wikiChipLabel } from "@renderer/editor/wiki-chip";
import { useVault } from "@renderer/workspace/vault-context";
import { parseWikiBody } from "@repo/notes/markdown/remark-wiki-link";

// Depth/cycle scope context — the policy itself lives in transclusion-guard.ts.
const TransclusionScopeContext = createContext<TransclusionScope | null>(null);

// ---------------------------------------------------------------------------
// Static components for the read-only render. The default static renderers
// already produce solid markup (headings, marks, lists, quotes, code); these
// cover the nodes that would otherwise render empty or unstyled voids.
// ---------------------------------------------------------------------------

function LinkStatic(props: SlateElementProps) {
  const url = typeof props.element.url === "string" ? props.element.url : "";
  return (
    <SlateElement
      {...props}
      as="a"
      attributes={{ ...props.attributes, href: url, rel: "noreferrer", target: "_blank" }}
    >
      {props.children}
    </SlateElement>
  );
}

function WikiLinkStatic(props: SlateElementProps) {
  const body = typeof props.element.body === "string" ? props.element.body : "";
  return (
    <SlateElement {...props} as="span">
      <WikiChip body={body} />
      {props.children}
    </SlateElement>
  );
}

/** Embeds inside embedded content: always a chip (depth guard) — but still a
 * navigable one. */
function WikiEmbedStatic(props: SlateElementProps) {
  const body = typeof props.element.body === "string" ? props.element.body : "";
  return (
    <SlateElement {...props} as="span">
      <EmbedChip body={body} />
      {props.children}
    </SlateElement>
  );
}

function DateStatic(props: SlateElementProps) {
  const date = typeof props.element.date === "string" ? props.element.date : "";
  return (
    <SlateElement {...props} as="span" className="rounded-sm bg-muted px-1 text-muted-foreground">
      {date || "date"}
      {props.children}
    </SlateElement>
  );
}

function EquationStatic(props: SlateElementProps) {
  const tex = typeof props.element.texExpression === "string" ? props.element.texExpression : "";
  return (
    <SlateElement {...props} className="my-1">
      <code>{tex}</code>
      {props.children}
    </SlateElement>
  );
}

function InlineEquationStatic(props: SlateElementProps) {
  const tex = typeof props.element.texExpression === "string" ? props.element.texExpression : "";
  return (
    <SlateElement {...props} as="span">
      <code>{tex}</code>
      {props.children}
    </SlateElement>
  );
}

/** Media voids (video / tweet / pdf) compact to a link — a full player inside
 * a read-only digest is noise. */
function MediaStatic(props: SlateElementProps) {
  const url = typeof props.element.url === "string" ? props.element.url : "";
  return (
    <SlateElement {...props} className="my-1">
      <a href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
      {props.children}
    </SlateElement>
  );
}

function FrontmatterStatic(props: SlateElementProps) {
  return (
    <SlateElement {...props} className="hidden">
      {props.children}
    </SlateElement>
  );
}

// Tables: the default static renderer is a bare <div> per node, which
// flattens a transcluded table into stacked lines (#376). Mirror the live
// table-kit markup — table > tbody > tr > td/th, same cell classes.
function TableStatic(props: SlateElementProps) {
  return (
    <SlateElement {...props} as="table" className="my-1">
      <tbody>{props.children}</tbody>
    </SlateElement>
  );
}

function TableRowStatic(props: SlateElementProps) {
  return <SlateElement {...props} as="tr" />;
}

const STATIC_COMPONENTS: Record<string, (props: SlateElementProps) => ReactNode> = {
  a: LinkStatic,
  date: DateStatic,
  equation: EquationStatic,
  inline_equation: InlineEquationStatic,
  video: MediaStatic,
  media_embed: MediaStatic,
  file: MediaStatic,
  frontmatter: FrontmatterStatic,
  table: TableStatic,
  tr: TableRowStatic,
  td: classNameSlateElement("td", TABLE_CELL_CLASS),
  th: classNameSlateElement("th", TABLE_HEADER_CELL_CLASS),
  wikiLink: WikiLinkStatic,
  wikiEmbed: WikiEmbedStatic,
};

// withComponent returns extended copies — BASE_KIT itself (the serialization
// mirror) is never mutated.
const TRANSCLUSION_KIT = BASE_KIT.map((plugin) => {
  const component = STATIC_COMPONENTS[plugin.key];
  return component ? plugin.withComponent(component) : plugin;
});

// ---------------------------------------------------------------------------
// Target content, read through the bridge and refreshed on vault changes.
// ---------------------------------------------------------------------------

type TargetContent =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; content: string };

function useTargetContent(path: string | null): TargetContent {
  const [state, setState] = useState<TargetContent>({ status: "loading" });
  useEffect(() => {
    if (path === null) return;
    const bridge = getBridge();
    let live = true;
    const read = () => {
      bridge
        .readVaultDoc({ path })
        .then((content) => {
          if (!live) return;
          setState((prev) =>
            prev.status === "ready" && prev.content === content
              ? prev
              : { status: "ready", content },
          );
          return undefined;
        })
        .catch(() => {
          if (live) setState({ status: "missing" });
        });
    };
    read();
    // The vault event carries no path — re-read unconditionally (a cheap
    // index-map/disk read) rather than tracking per-file freshness here.
    const unsubscribe = bridge.onVaultChanged(read);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [path]);
  return state;
}

// ---------------------------------------------------------------------------
// Chip fallbacks + the expanded card
// ---------------------------------------------------------------------------

/** The `!`-prefixed embed chip (unresolved / cycle / depth-guarded). */
function EmbedChip({ body, note }: { body: string; note?: string | undefined }) {
  return (
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
}

function TransclusionBody({ content }: { content: string }) {
  const parsed = useMemo(() => parseMarkdown(content), [content]);
  const editor = useMemo(
    () =>
      parsed.ok ? createSlateEditor({ plugins: TRANSCLUSION_KIT, value: parsed.value }) : null,
    [parsed],
  );
  if (content.trim() === "") {
    return <span className="text-sm text-muted-foreground italic">This note is empty.</span>;
  }
  if (!editor) {
    // Out-of-vocabulary / unparseable target — show the bytes rather than
    // nothing (the same honesty rule as the Raw editor mode).
    return <pre className="whitespace-pre-wrap">{content}</pre>;
  }
  return <PlateStatic editor={editor} />;
}

export default function Transclusion({ body }: { body: string }) {
  const { resolveWikiTarget, openFile } = useVault();
  // The cycle chain roots at the note HOSTING this embed — the single
  // mounted editor always serves vault-context's open note.
  const hostPath = useVault().editor.path;
  const scope = useContext(TransclusionScopeContext);
  const parsed = parseWikiBody(body);
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target);
  const content = useTargetContent(resolved);

  const effectiveScope: TransclusionScope = useMemo(
    () =>
      scope ?? {
        depth: 0,
        chain: hostPath !== null ? [hostPath] : [],
      },
    [scope, hostPath],
  );
  const innerScope = useMemo(
    () => (resolved !== null ? nestedScope(effectiveScope, resolved) : null),
    [effectiveScope, resolved],
  );

  // Guards, in order: unresolved → chip; nested-in-embed → chip; cycle →
  // chip + note; missing on read → chip.
  const decision = decideTransclusion(effectiveScope, resolved);
  if (decision.kind === "chip") {
    return <EmbedChip body={body} note={decision.reason === "cycle" ? "circular" : undefined} />;
  }
  if (content.status === "missing") return <EmbedChip body={body} />;

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
          title={target}
          className="cursor-pointer truncate text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          {title}
        </button>
      </span>
      <span className="block overflow-x-auto px-3 py-2">
        {content.status === "loading" || innerScope === null ? (
          <span className="text-muted-foreground italic">Loading…</span>
        ) : (
          <TransclusionScopeContext.Provider value={innerScope}>
            <TransclusionBody content={content.content} />
          </TransclusionScopeContext.Provider>
        )}
      </span>
    </span>
  );
}
