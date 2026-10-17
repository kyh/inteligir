// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

import { cn } from "@repo/ui/lib/cn";

import { getEditorHostIo, vaultChangeTouches } from "@repo/editor/host-io";
import { EmbedChip, StaticNote } from "@repo/editor/static-note";
import { decideTransclusion } from "@repo/editor/transclusion-guard";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { useLinkResolver, useVaultActions } from "@repo/editor/host";
import { parseWikiBody, wikiLinkLabel } from "@repo/notes/markdown/remark-wiki-link";

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

const Transclusion = ({ body }: { body: string }) => {
  const { resolveWikiTarget } = useLinkResolver();
  const { openFile } = useVaultActions();
  const hostPath = useOpenNote((s) => (s.editor.kind === "open" ? s.editor.path : null));
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
          <StaticNote content={content.content} path={target} />
        )}
      </span>
    </span>
  );
};

export default Transclusion;
