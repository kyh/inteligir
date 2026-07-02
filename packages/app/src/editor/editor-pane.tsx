import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { EditorPaneContext } from "@repo/app/editor/editor-pane-context";
import { MarkdownEditor } from "@repo/app/editor/markdown-editor";
import { BacklinksPanel } from "@repo/app/workspace/backlinks-panel";
import { touchRecency } from "@repo/app/workspace/tab-session";
import { useVault } from "@repo/app/workspace/vault-context";

/**
 * How many tabs keep a live (mounted) pane. Every live pane holds a full
 * Plate editor whose undo history, DOM, selection, and scroll position
 * survive tab switches (#369) — but each one costs memory, so only the N
 * most-recently-active tabs stay live; older tabs fall back to the v1
 * behavior (remount on activation, history starts fresh). Five covers the
 * working set people actually alternate between without letting a
 * twenty-tab session hold twenty documents' DOM alive.
 */
const MAX_LIVE_PANES = 5;

/** The most-recently-activated open tabs, capped — the set of tabs whose
 * panes stay mounted. Maintained with the render-adjust pattern so the set
 * is correct in the same render that changes the active tab. */
function useLivePaths(tabs: readonly string[], active: string | null): readonly string[] {
  const [recency, setRecency] = useState<readonly string[]>([]);
  const next = touchRecency(recency, tabs, active);
  if (next !== recency) setRecency(next);
  return useMemo(() => next.slice(0, MAX_LIVE_PANES), [next]);
}

/**
 * The editor body — one pane per live tab, all mounted, only the active one
 * visible. Hiding (display:none) instead of remounting is what preserves
 * each tab's undo history and in-progress editor state across switches; the
 * workspace <main> is the single scroll container, so per-tab scroll offsets
 * are captured/restored around the visibility swap. The per-file controls
 * (raw/rich, Format, delete, status) live in the shell header; this is just
 * the scrolling document. Bottom padding clears the pinned composer.
 */
export function EditorPane() {
  const { tabs, activeTab } = useVault();
  const livePaths = useLivePaths(tabs, activeTab);

  // Per-tab scroll offsets. The scroller is the workspace <main> (a shared
  // container — toc.tsx keys off the same element), so hidden panes don't
  // retain a scroll position of their own: save the active tab's offset as
  // it scrolls, restore it right after the pane swap (layout effect = after
  // the DOM shows the new pane, before paint — no flicker).
  const scrollTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (activeTab === null) return;
    const scroller = document.querySelector("main");
    if (!scroller) return;
    scroller.scrollTop = scrollTops.current.get(activeTab) ?? 0;
    const save = () => scrollTops.current.set(activeTab, scroller.scrollTop);
    scroller.addEventListener("scroll", save, { passive: true });
    return () => scroller.removeEventListener("scroll", save);
  }, [activeTab]);
  useEffect(() => {
    for (const path of scrollTops.current.keys()) {
      if (!tabs.includes(path)) scrollTops.current.delete(path);
    }
  }, [tabs]);

  if (activeTab === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a note to edit, or create one. The agent edits these same files.
      </div>
    );
  }

  // Panes render in STRIP order (stable while tabs stay open), not recency
  // order — reordering keyed children moves DOM nodes, which reloads iframes
  // (embeds/transclusions) and drops native textarea state.
  return (
    <>
      {tabs
        .filter((path) => livePaths.includes(path))
        .map((path) => (
          <TabPane key={path} path={path} active={path === activeTab} />
        ))}
    </>
  );
}

/** One tab's pane: page title + body (+ backlinks), fed by its OWN tab
 * state. Stays mounted while the tab is live; `active: false` only hides it. */
function TabPane({ path, active }: { path: string; active: boolean }) {
  const {
    subscribeTab,
    getTabState,
    editTab,
    renameEntry,
    isMarkdownOpen,
    richSafe,
    mode,
    analyzedPath,
  } = useVault();

  const subscribe = useCallback((fn: () => void) => subscribeTab(path, fn), [subscribeTab, path]);
  const getSnapshot = useCallback(() => getTabState(path), [getTabState, path]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // The context's mode/richSafe describe the tab the provider ANALYZED —
  // the active tab, except while a just-activated tab is still dirty
  // (analysis waits for saved bytes). Adopt the context view only when it's
  // coherent for THIS pane; otherwise keep the last adopted surface, so a
  // hidden pane never flips between rich/raw because a sibling tab changed
  // the shared view state. Render-adjusted so surface and content can't
  // disagree within a commit (same pattern as the provider's analysis gate).
  const coherent = active && analyzedPath === path;
  const ctxShowRich = mode === "rich" && isMarkdownOpen && richSafe;
  const [frozenShowRich, setFrozenShowRich] = useState(false);
  if (coherent && frozenShowRich !== ctxShowRich) setFrozenShowRich(ctxShowRich);
  const showRich = coherent ? ctxShowRich : frozenShowRich;

  const fileName = state.path !== null ? (state.path.split("/").pop() ?? state.path) : "";
  const dot = fileName.lastIndexOf(".");
  const displayName = dot > 0 ? fileName.slice(0, dot) : fileName;

  // The title is a contentEditable, so React must NOT own its text children
  // (reconciling a contentEditable's children accumulates stale text across
  // note switches). We set the text imperatively when the file (re)names;
  // the browser owns it while editing.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.textContent = displayName;
  }, [displayName]);

  const paneInfo = useMemo(() => ({ path, active }), [path, active]);

  // Still loading (or vanishing) — nothing to show yet; the runtime either
  // fills in content or closes the tab.
  if (state.path === null) return null;

  const ext = dot > 0 ? fileName.slice(dot) : "";
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);

  // Editing the title renames the underlying file (the filename IS the title).
  const commitTitle = (raw: string) => {
    const next = raw.trim();
    if (next === "" || next === displayName) {
      if (titleRef.current) titleRef.current.textContent = displayName;
      return;
    }
    void renameEntry(path, `${dir}${next}${ext}`).then((ok) => {
      // On success the path changes and the renamed tab mounts a fresh pane;
      // on failure roll the contentEditable back to the real filename so the
      // title never shows a name that was never saved.
      if (!ok && titleRef.current) titleRef.current.textContent = displayName;
      return undefined;
    });
  };

  // Enter in the title drops the caret into the body (potion behavior): the
  // editor's editable in Rich mode, the textarea in Raw. The body mounts as a
  // sibling inside paneRef, so the query never escapes this pane.
  const onTitleKeyDown = (e: KeyboardEvent<HTMLHeadingElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      paneRef.current?.querySelector<HTMLElement>('[data-slate-editor="true"], textarea')?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.textContent = displayName;
      e.currentTarget.blur();
    }
  };

  // potion-style column: a centered 700px text column (symmetric padding, not
  // max-w), the filename rendered as a large editable page title (chrome only —
  // never serialized), then the body. Same column wraps the Raw textarea; the
  // pb-72 is the breathing room below the last block (spec §4.1 — the pane,
  // not PlateContent, owns column + padding so title/raw/rich share bytes-
  // exact geometry). Inactive panes hide via inline display:none (inline so
  // no utility-class cascade order can override it) — never unmount, that's
  // the whole point (#369).
  return (
    <EditorPaneContext.Provider value={paneInfo}>
      <div
        ref={paneRef}
        style={active ? undefined : { display: "none" }}
        className="flex w-full flex-1 cursor-text flex-col px-12 pt-10 pb-72 sm:px-[max(48px,calc(50%-350px))]"
      >
        <h1
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => commitTitle(e.currentTarget.textContent ?? "")}
          onKeyDown={onTitleKeyDown}
          className="mb-1 w-full break-words text-4xl font-bold leading-[1.2] text-foreground outline-none empty:before:text-muted-foreground/40 empty:before:content-['Untitled']"
        />
        {showRich ? (
          <MarkdownEditor
            path={path}
            value={state.content}
            onChange={(md) => {
              if (md !== getTabState(path).content) editTab(path, md);
            }}
            // Teardown settle (#374): route by the path THIS editor served —
            // panes unmount on close/eviction, when the active tab may
            // already differ, so the bytes carry their own path.
            onSettled={(md) => {
              if (md !== getTabState(path).content) editTab(path, md);
            }}
          />
        ) : (
          <textarea
            value={state.content}
            onChange={(e) => editTab(path, e.target.value)}
            spellCheck={false}
            className="min-h-[60vh] flex-1 resize-none bg-transparent pt-4 font-mono text-sm leading-relaxed text-foreground outline-none"
            placeholder="Empty note"
          />
        )}
        {/* Linked mentions live in the same centered column, below the doc. */}
        <BacklinksPanel path={path} />
      </div>
    </EditorPaneContext.Provider>
  );
}
