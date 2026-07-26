// The sidebar's Tags group: a persistent, collapsible browse affordance over
// the tag index the palette already exposes (`#` → tag → notes). Selecting a
// tag hands the palette the request (command/tags.ts) rather than rendering a
// second note list here — one tag browser, three entry points.
//
// BROWSE ONLY, permanently. No rename, no delete: tags are a projection over
// note bodies, so a "rename tag" chip action is a bulk content mutation
// wearing a filter's clothes (CLAUDE.md § Decisions). Editing the notes — or
// asking the agent — is the affordance.

import { useEffect, useState } from "react";
import { ChevronRightIcon, HashIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { browseTag, openTagList, refreshTags, useTags } from "@renderer/command/tags";
import { useOpenNote } from "@renderer/workspace/open-note-store";
import { useVaultListing } from "@renderer/workspace/vault-context";

// A long tail of one-note tags would push the file tree off screen, and the
// group is a browse shortcut, not a tag manager. Past this many rows the
// remainder lives behind "Show all tags…", which opens the palette's filterable
// list — the surface built for hundreds of tags.
const VISIBLE_TAGS = 12;

/**
 * Tags, most-used first, with per-tag note counts. Its own component (not part
 * of AppSidebar) so its subscriptions — the shared tag store and the open
 * note's save flag — re-render this group alone.
 */
export function TagsSection() {
  const { entries } = useVaultListing();
  const tags = useTags((s) => s.tags);
  const loaded = useTags((s) => s.loaded);
  const [expanded, setExpanded] = useState(true);

  // Structural refreshes (window focus, app writes, delegation completion,
  // "Refresh vault") are when files appear/vanish, so the tag set can move.
  useEffect(() => {
    refreshTags();
  }, [entries]);

  // …but a `#tag` typed into an EXISTING note changes no listing, so also
  // refresh when a save completes (the false edge of `saving`, which is also
  // the mount state — that's what performs the initial load). Save-completed
  // is the right beat: the host reconciles the knowledge index off the same
  // write.
  const saving = useOpenNote((s) => s.editor.saving);
  useEffect(() => {
    if (!saving) refreshTags();
  }, [saving]);

  // Nothing to browse yet: stay silent rather than showing an empty group.
  if (!loaded || tags.length === 0) return null;

  const visible = tags.slice(0, VISIBLE_TAGS);
  const overflow = tags.length - visible.length;

  return (
    <SidebarGroup className="gap-1 p-0">
      <SidebarGroupLabel
        render={<button type="button" />}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="w-full gap-1 px-2 hover:text-sidebar-foreground"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
        />
        <span>Tags</span>
        <span className="ml-auto text-[10px] tabular-nums">{tags.length}</span>
      </SidebarGroupLabel>
      {expanded && (
        <SidebarMenu aria-label="Tags">
          {visible.map((entry) => (
            <SidebarMenuItem key={entry.tag}>
              <SidebarMenuButton
                size="sm"
                onClick={() => browseTag(entry.tag)}
                title={`${entry.count} note${entry.count === 1 ? "" : "s"} tagged #${entry.tag}`}
                className="font-normal focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              >
                <HashIcon />
                <span className="min-w-0 flex-1 truncate">{entry.tag}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {entry.count}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {overflow > 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                onClick={() => openTagList()}
                className="font-normal text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              >
                <span className="size-4 shrink-0" aria-hidden />
                <span className="truncate">Show all tags… ({overflow} more)</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
