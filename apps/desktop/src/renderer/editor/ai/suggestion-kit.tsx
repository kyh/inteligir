// Suggestion rendering — insertions and deletions from an AI edit show as
// track-changes marks (leaf styling for text runs, a wrapper for block-level
// inserts/removes). Rendering adapted from potion's suggestion-node
// (rewrite-on-our-tokens; the machinery is @platejs/suggestion, MIT).
//
// The plugin is registered in the LIVE editor only: files never contain
// suggestion marks (nothing serializes them — see transient.ts), so the
// headless serialization mirror doesn't need it.

import { BaseSuggestionPlugin, type BaseSuggestionConfig } from "@platejs/suggestion";
import { CornerDownLeftIcon } from "lucide-react";
import type { ExtendConfig, TSuggestionData, TSuggestionText } from "platejs";
import {
  PlateLeaf,
  toTPlatePlugin,
  useEditorPlugin,
  usePluginOption,
  type PlateLeafProps,
} from "platejs/react";
import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

type SuggestionConfig = ExtendConfig<
  BaseSuggestionConfig,
  {
    /** Suggestion id the review bar currently points at (highlight). */
    activeId: string | null;
  }
>;

export const suggestionPlugin = toTPlatePlugin<SuggestionConfig>(BaseSuggestionPlugin, {
  options: {
    activeId: null,
    // Stamped as userId on diff marks; purely informational (single-user app).
    currentUserId: "ai",
    isSuggesting: false,
  },
});

function suggestionClass(remove: boolean, active: boolean): string {
  return cn(
    remove
      ? "bg-muted text-muted-foreground line-through decoration-muted-foreground/60"
      : "border-b-2 border-b-primary/30 bg-primary/10 text-primary",
    active && (remove ? "bg-muted-foreground/20" : "border-b-primary/60 bg-primary/20"),
    "transition-colors duration-150",
  );
}

function SuggestionLeaf(props: PlateLeafProps<TSuggestionText>) {
  const { api, setOption } = useEditorPlugin(suggestionPlugin);
  const activeId = usePluginOption(suggestionPlugin, "activeId");

  const dataList = api.suggestion.dataList(props.leaf);
  const leafId = api.suggestion.nodeId(props.leaf) ?? "";
  const hasRemove = dataList.some((data) => data.type === "remove");
  const isActive = dataList.some((data) => data.id === activeId);

  return (
    <PlateLeaf
      {...props}
      as={hasRemove ? "del" : "ins"}
      attributes={{
        ...props.attributes,
        onClick: () => setOption("activeId", leafId),
      }}
      className={cn("no-underline", suggestionClass(hasRemove, isActive))}
    />
  );
}

function SuggestionBlock({ children, data }: { children: ReactNode; data: TSuggestionData }) {
  const { setOption } = useEditorPlugin(suggestionPlugin);
  const activeId = usePluginOption(suggestionPlugin, "activeId");
  const isRemove = data.type === "remove";
  const isActive = activeId === data.id;

  if (data.isLineBreak) {
    // A proposed block split/merge: the block's text is original, only the
    // boundary is suggested — mark it with a return glyph instead of tinting.
    return (
      <>
        {children}
        <span
          className={cn("absolute", suggestionClass(isRemove, isActive))}
          contentEditable={false}
          style={{ bottom: 4, height: 20 }}
        >
          <CornerDownLeftIcon className="mt-0.5 size-4" />
        </span>
      </>
    );
  }
  return (
    <div
      className={suggestionClass(isRemove, isActive)}
      data-block-suggestion="true"
      onClick={() => setOption("activeId", data.id)}
    >
      {children}
    </div>
  );
}

export const SuggestionKit = [
  suggestionPlugin.configure({
    render: {
      // Block-level suggestions (an inserted or removed whole block, or a
      // proposed block split/merge) tint the entire block.
      belowNodes: ({ api, element }) => {
        if (!api.suggestion.isBlockSuggestion(element)) return;
        const data = element.suggestion;
        return function Wrapper({ children }) {
          return <SuggestionBlock data={data}>{children}</SuggestionBlock>;
        };
      },
      node: SuggestionLeaf,
    },
  }),
];
