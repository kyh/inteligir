import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { KEYS } from "platejs";
import type { TElement } from "platejs";
import { createPlatePlugin, useEditorRef, useEditorSelector } from "platejs/react";
import type { RenderNodeWrapper } from "platejs/react";
import { ChevronDownIcon } from "lucide-react";
import { z } from "zod";
import { useStore } from "zustand";
import { persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createStore } from "zustand/vanilla";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { blockId } from "@repo/editor/headless/node-props";
import { OpenItemPlugin } from "@repo/editor/open-item";

const STORAGE_KEY = "inteligir.collapsed-headings";

export const HEADING_RANK = new Map<string, number>([
  [KEYS.h1, 1],
  [KEYS.h2, 2],
  [KEYS.h3, 3],
]);

type Folds = Readonly<Record<string, readonly string[]>>;

const STORED_FOLDS = z.record(z.string(), z.array(z.string()));

const foldsStore = createStore<Folds>()(
  persist(() => ({}), {
    merge: (stored) => STORED_FOLDS.safeParse(stored).data ?? {},
    name: STORAGE_KEY,
  }),
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      void foldsStore.persist.rehydrate();
    }
  });
}

const headingIds = (children: readonly TElement[]) =>
  new Set(
    children.flatMap((child) => {
      const id = blockId(child);

      return HEADING_RANK.has(child.type) && id !== undefined ? [id] : [];
    }),
  ) satisfies ReadonlySet<string>;

const toggleFold = (itemId: string, headingId: string, children: readonly TElement[]) => {
  const held = headingIds(children);
  foldsStore.setState(({ [itemId]: folded = [], ...others }) => {
    const flipped = folded.includes(headingId)
      ? folded.filter((id) => id !== headingId)
      : [...folded, headingId];

    const kept = flipped.filter((id) => held.has(id));

    return kept.length === 0 ? others : { ...others, [itemId]: kept };
  }, true);
};

export const forgetHeadingFolds = () => {
  foldsStore.setState({}, true);
};

const NO_FOLDS: readonly string[] = [];

interface Derived {
  itemId: string;
  folded: readonly string[];
  hidden: ReadonlySet<string>;
}

const derive = (children: readonly TElement[], itemId: string, folded: readonly string[]) => {
  const hidden = new Set<string>();
  const stack: number[] = [];

  for (const child of children) {
    const id = blockId(child);
    const rank = HEADING_RANK.get(child.type);

    if (rank !== undefined) {
      while (stack.length > 0 && (stack.at(-1) ?? 0) >= rank) {
        stack.pop();
      }
    }

    if (id === undefined) {
      continue;
    }

    if (stack.length > 0) {
      hidden.add(id);
    }

    if (rank !== undefined && folded.includes(id)) {
      stack.push(rank);
    }
  }

  return { folded, hidden, itemId } satisfies Derived;
};

const sameDerived = (a: Derived | null, b: Derived | null) => {
  if (a === null || b === null) {
    return a === b;
  }

  return a.itemId === b.itemId && a.folded === b.folded && shallow(a.hidden, b.hidden);
};

const DerivedContext = createContext<Derived | null>(null);

const CollapseProvider = ({ children }: { children: ReactNode }) => {
  const itemId = useEditorRef().getOption(OpenItemPlugin, "itemId");

  const folded = useStore(foldsStore, (folds) =>
    itemId === null ? NO_FOLDS : (folds[itemId] ?? NO_FOLDS),
  );

  const derived = useEditorSelector(
    (editor) => (itemId === null ? null : derive(editor.children, itemId, folded)),
    [itemId, folded],
    { equalityFn: sameDerived },
  );

  return <DerivedContext value={derived}>{children}</DerivedContext>;
};

const CollapsibleBlock = ({
  id,
  isHeading,
  children,
}: {
  id: string;
  isHeading: boolean;
  children: ReactNode;
}) => {
  const editor = useEditorRef();
  const derived = useContext(DerivedContext);
  const isHidden = derived?.hidden.has(id) === true;

  if (derived === null || !isHeading) {
    return <div className={cn(isHidden && "hidden")}>{children}</div>;
  }

  const { itemId } = derived;
  const isCollapsed = derived.folded.includes(id);

  return (
    <div className={cn("group/heading relative", isHidden && "hidden")}>
      <Tooltip content={isCollapsed ? "Expand section" : "Collapse section"}>
        <button
          type="button"
          contentEditable={false}
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!isCollapsed}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            toggleFold(itemId, id, editor.children);
          }}
          className={cn(
            "absolute top-1/2 -left-6 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-transform select-none hover:bg-accent [&_svg]:size-3.5",
            isCollapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover/heading:opacity-100",
          )}
        >
          <ChevronDownIcon />
        </button>
      </Tooltip>
      {children}
    </div>
  );
};

const CollapseWrapper: RenderNodeWrapper = ({ element, path }) => {
  const id = blockId(element);

  if (path.length !== 1 || id === undefined) {
    return;
  }

  const isHeading = HEADING_RANK.has(element.type);

  return function CollapsibleBlockWrapper({ children }) {
    return (
      <CollapsibleBlock id={id} isHeading={isHeading}>
        {children}
      </CollapsibleBlock>
    );
  };
};

export const HeadingCollapseKit = [
  createPlatePlugin({
    key: "headingCollapse",
    render: {
      aboveEditable: ({ children }) => <CollapseProvider>{children}</CollapseProvider>,
      aboveNodes: CollapseWrapper,
    },
  }),
];
