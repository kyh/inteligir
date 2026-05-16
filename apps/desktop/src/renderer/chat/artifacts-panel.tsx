import { useEffect, useState } from "react";
import { ExternalLinkIcon, Trash2Icon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import type { Artifact } from "@/shared/artifacts";

type Props = {
  /** Currently-open artifact ids; the panel uses this to label the Open button. */
  openIds: ReadonlySet<string>;
  /** Open (or focus) the floating panel for an artifact. */
  onOpen: (id: string) => void;
};

/**
 * Library view of all artifacts the agent has created. Lists them newest-first
 * and offers "Open" (spawn / focus a floating panel) and "Remove" controls.
 * The agent owns content; users only manage which artifacts exist and which
 * are visible.
 */
export function ArtifactsPanel({ openIds, onOpen }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let broadcastSeen = false;

    const apply = (list: { artifacts: Artifact[] }) => {
      if (cancelled) return;
      setArtifacts(sortNewestFirst(list.artifacts));
    };

    const off = bridge.onArtifactsUpdated((list) => {
      broadcastSeen = true;
      apply(list);
    });
    bridge
      .listArtifacts()
      .then((list) => {
        // Skip the stale read if a broadcast with newer data has already
        // arrived between subscribe and the IPC response landing.
        if (!cancelled && !broadcastSeen) apply(list);
        return null;
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleDelete = async (id: string) => {
    await getBridge()?.deleteArtifact(id);
    // The broadcast will refresh the list — no local mutation needed.
  };

  if (artifacts === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Label className="text-xs font-medium text-muted-foreground">Artifacts</Label>
        <div className="rounded-md border border-border px-3 py-2 text-[11px] text-muted-foreground">
          No artifacts yet. Ask the agent to create one — e.g. "make a panel that…".
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <Label className="text-xs font-medium text-muted-foreground">Artifacts</Label>
      <div className="flex flex-col gap-2">
        {artifacts.map((a) => {
          const isOpen = openIds.has(a.id);
          return (
            <div
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-foreground">{a.title}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {a.description ?? `Updated ${formatRelative(a.updatedAt)}`}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onOpen(a.id)}
                  aria-label={isOpen ? "Focus artifact" : "Open artifact"}
                  title={isOpen ? "Focus" : "Open"}
                >
                  <ExternalLinkIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void handleDelete(a.id)}
                  aria-label="Remove artifact"
                  title="Remove"
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortNewestFirst(artifacts: Artifact[]): Artifact[] {
  return [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
