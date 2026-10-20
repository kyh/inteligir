// CLAUDE.md § THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND. An open item, full size: the
// editor for a note, a saved page's source over its text, a viewer for a picture, a PDF, a video,
// a sound or any other file, and the placeholder for a stub whose page is not read yet. A viewer
// still opens its wrapper through the session, so History, ⌘K and Info bind to that path; "Edit
// as note" swaps the viewer for the editor. Escape goes back to the library, from anywhere the
// item view holds focus that is not text entry.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { LibraryScope } from "@repo/domain/library-scope";
import { EditorColumn } from "@repo/editor/editor-column";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { isTextEntryTarget } from "../global-shortcuts";
import { libraryShortcutFor } from "../library/library-keys";
import { useItemRow } from "../library/library-items";
import { NoteFooter } from "../note-footer";
import type { TopbarLeadProps } from "../topbar-lead";
import { useMediaOrigin } from "../vault-hooks";
import type { MediaOrigin } from "../vault-hooks";
import {
  FileStage,
  ImageStage,
  MediaStage,
  PdfStage,
  PendingStage,
  SourceHeader,
} from "./item-stages";
import { ItemTopbar } from "./item-topbar";
import type { ItemFace } from "./item-topbar";
import { useOpenItem } from "./open-item-kind";
import type { OpenItem } from "./open-item-kind";
import { SnapshotFrame } from "./snapshot-frame";

export interface ItemViewProps {
  store: OpenNoteStore;
  lead: TopbarLeadProps;
  insetTitleBar: boolean;
  zen: boolean;
  onGoToLibrary: (scope?: LibraryScope) => void;
  onFindInNote: () => void;
  annotationCount: number;
  onOpenAnnotations: () => void;
  onExportPdf: () => void;
  // Refresh from the page, for a stub this Mac did not save
  onReadHere: (path: string) => void;
}

// where a saved page came from: its address, its site and when it was saved
interface Source {
  readonly url: string;
  readonly site: string | null;
  readonly host: string | null;
  readonly savedMs: number | null;
}

const sourceOf = (item: OpenItem): Source | null => {
  const { facts } = item;
  if (facts === null || facts.url === null || !URL_ITEM_KINDS.some((kind) => kind === item.kind)) {
    return null;
  }
  return { host: facts.host, savedMs: facts.savedMs, site: facts.site, url: facts.url };
};

// a viewer kind shows the original; a note and a saved page show the editor
const showsViewer = (item: OpenItem, file: string | null): boolean => {
  switch (item.kind) {
    case "note":
    case "link": {
      return false;
    }
    case "video":
    case "audio": {
      return file !== null;
    }
    case "image":
    case "pdf":
    case "file": {
      return true;
    }
    default: {
      const exhaustive: never = item.kind;
      return exhaustive;
    }
  }
};

const SourceBar = ({ source }: { source: Source }) => (
  <SourceHeader url={source.url} site={source.site} host={source.host} savedMs={source.savedMs} />
);

// the editor, under a saved page's source when it has one
const ArticleStage = ({
  path,
  source,
  footer,
}: {
  path: string;
  source: Source | null;
  footer: boolean;
}) => (
  <>
    {source === null ? null : <SourceBar source={source} />}
    <div data-editor-scroller="" className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
      <EditorColumn />
    </div>
    {footer ? <NoteFooter path={path} /> : null}
  </>
);

const ViewerStage = ({
  item,
  file,
  row,
  media,
}: {
  item: OpenItem;
  file: string;
  row: ItemRowWire | null;
  media: MediaOrigin;
}) => {
  switch (item.kind) {
    case "image": {
      return <ImageStage file={file} media={media} />;
    }
    case "pdf": {
      return <PdfStage file={file} media={media} />;
    }
    case "video":
    case "audio": {
      return <MediaStage file={file} kind={item.kind} media={media} />;
    }
    case "file":
    case "note":
    case "link": {
      return <FileStage file={file} bytes={row?.fileBytes ?? null} />;
    }
    default: {
      const exhaustive: never = item.kind;
      return exhaustive;
    }
  }
};

// how the open item is shown now: the stage, the face a saved page wears, and what may edit it
interface Showing {
  readonly stage: "pending" | "viewer" | "article" | "page-copy";
  readonly file: string | null;
  readonly copy: string | null;
  readonly source: Source | null;
}

const showingOf = (
  item: OpenItem,
  row: ItemRowWire | null,
  asNote: boolean,
  face: ItemFace,
): Showing => {
  const file = item.bareFile ?? row?.file ?? null;
  const copy = asNote ? null : (row?.copy ?? null);
  const source = asNote ? null : sourceOf(item);
  if (item.pending) {
    return { copy: null, file, source: null, stage: "pending" };
  }
  if (!asNote && showsViewer(item, file)) {
    return { copy, file, source, stage: "viewer" };
  }
  const pageCopy = source !== null && copy !== null && face === "page-copy";
  return { copy, file, source, stage: pageCopy ? "page-copy" : "article" };
};

// a bare file the index no longer lists as an item: deleted or moved, with nothing to show
const isGone = (item: OpenItem | null, read: boolean, row: ItemRowWire | null): boolean =>
  item !== null && item.bareFile !== null && read && row === null;

// what the top bar offers for what is shown: the editor's verbs, the address, the page's two faces
const barFacts = (item: OpenItem, showing: Showing, face: ItemFace) => ({
  editAsNote: showing.stage === "viewer" && item.bareFile === null,
  editable:
    (showing.stage === "article" || showing.stage === "page-copy") && item.bareFile === null,
  face: showing.source !== null && showing.copy !== null ? face : null,
  url: sourceOf(item)?.url ?? null,
});

// the stage the item is shown on, by what `showingOf` said
const ShownStage = ({
  showing,
  item,
  row,
  media,
  footer,
  onReadHere,
}: {
  showing: Showing;
  item: OpenItem;
  row: ItemRowWire | null;
  media: MediaOrigin | null;
  footer: boolean;
  onReadHere: (path: string) => void;
}) => {
  switch (showing.stage) {
    case "pending": {
      return (
        <PendingStage
          onReadHere={() => {
            onReadHere(item.path);
          }}
        />
      );
    }
    case "viewer": {
      return showing.file === null || media === null ? (
        <div className="flex min-h-0 flex-1" />
      ) : (
        <ViewerStage item={item} file={showing.file} row={row} media={media} />
      );
    }
    case "page-copy": {
      return showing.copy === null || media === null || showing.source === null ? null : (
        <>
          <SourceBar source={showing.source} />
          <SnapshotFrame copy={showing.copy} media={media} />
        </>
      );
    }
    case "article": {
      return (
        <ArticleStage
          path={item.path}
          source={showing.source}
          footer={footer && item.kind === "note"}
        />
      );
    }
    default: {
      const exhaustive: never = showing.stage;
      return exhaustive;
    }
  }
};

export const ItemView = ({
  store,
  lead,
  insetTitleBar,
  zen,
  onGoToLibrary,
  onFindInNote,
  annotationCount,
  onOpenAnnotations,
  onExportPdf,
  onReadHere,
}: ItemViewProps) => {
  const item = useOpenItem(store);
  const path = item?.path ?? null;
  const rowQuery = useItemRow(path);
  const row = rowQuery.data ?? null;
  const media = useMediaOrigin();
  // both are the open item's own, so another item opens on its article, in its viewer
  const [face, setFace] = useState<{ path: string; face: ItemFace } | null>(null);
  const [asNote, setAsNote] = useState<string | null>(null);

  // the keyboard lands in the item as it opens, so Escape goes back at once: opening from the
  // grid unmounts the focused card and leaves the focus nowhere. Whatever already holds the focus
  // (the editor's title, the panel, the composer) keeps it
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const nowhere = document.activeElement === null || document.activeElement === document.body;
    if (path !== null && root !== null && nowhere) {
      root.focus({ preventScroll: true });
    }
  }, [path]);

  // a bare file that is no longer an item (deleted, moved) has nothing to show
  const gone = isGone(item, rowQuery.isSuccess, row);
  useEffect(() => {
    if (gone) {
      onGoToLibrary();
    }
  }, [gone, onGoToLibrary]);

  if (item === null || path === null) {
    return <div className="flex min-h-0 flex-1 flex-col" />;
  }

  const shownFace: ItemFace = face?.path === path ? face.face : "article";
  const showing = showingOf(item, row, asNote === path, shownFace);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isTextEntryTarget(event.target)) {
      return;
    }
    const shortcut = libraryShortcutFor(event, "item", platformShortcutModifier());
    if (shortcut?.action === "back-to-library") {
      event.preventDefault();
      onGoToLibrary();
    }
  };

  const bar = barFacts(item, showing, shownFace);

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the item view's own key, Escape back to the library, listened on its root so a field inside keeps its own Escape
    <div
      ref={rootRef}
      tabIndex={-1}
      data-item-view={item.kind}
      data-item-path={path}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={onKeyDown}
    >
      {zen ? null : (
        <ItemTopbar
          path={path}
          lead={lead}
          insetTitleBar={insetTitleBar}
          onGoToLibrary={onGoToLibrary}
          editable={bar.editable}
          url={bar.url}
          face={bar.face}
          onFaceChange={(next) => {
            setFace({ face: next, path });
          }}
          onEditAsNote={
            bar.editAsNote
              ? () => {
                  setAsNote(path);
                }
              : null
          }
          onFindInNote={onFindInNote}
          annotationCount={annotationCount}
          onOpenAnnotations={onOpenAnnotations}
          onExportPdf={onExportPdf}
        />
      )}
      <ShownStage
        showing={showing}
        item={item}
        row={row}
        media={media}
        footer={!zen}
        onReadHere={onReadHere}
      />
    </div>
  );
};
