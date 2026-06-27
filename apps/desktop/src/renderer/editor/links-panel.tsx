import { useEffect, useState } from "react";
import { ArrowUpRightIcon, CornerUpLeftIcon, LinkIcon, Link2OffIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@/renderer/lib/bridge";
import { useVault } from "@/renderer/workspace/vault-context";
import type { NoteLinks } from "@/shared/wiki-links";

/** Obsidian-style link footer for the open note: outgoing [[links]] and the
 * notes that link back to it. Both navigate on click. */
export function LinksPanel() {
  const { editor, openFile } = useVault();
  const path = editor.path;
  const [links, setLinks] = useState<NoteLinks | null>(null);

  useEffect(() => {
    if (path === null) {
      setLinks(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const bridge = getBridge();
      if (!bridge) return;
      try {
        const next = await bridge.getNoteLinks({ path });
        if (!cancelled) setLinks(next);
      } catch {
        // Best-effort — leave the last-known links on a transient failure.
      }
    };
    void load();
    // Re-resolve on any vault change — a renamed/created note can fix or break links.
    const unsub = getBridge()?.onVaultChanged(() => void load());
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [path]);

  if (!links || (links.outgoing.length === 0 && links.backlinks.length === 0)) return null;

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 border-t border-border px-4 py-3 text-[11px]">
      {links.outgoing.length > 0 && (
        <Section icon={<ArrowUpRightIcon className="size-3" />} label="Links to">
          {links.outgoing.map((link) =>
            link.path === null ? (
              <span
                key={link.target}
                title="No matching note"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/60"
              >
                <Link2OffIcon className="size-3" />
                {link.alias ?? link.target}
              </span>
            ) : (
              <LinkChip
                key={link.target}
                onClick={() => openFile(link.path ?? "")}
                label={link.alias ?? link.target}
              />
            ),
          )}
        </Section>
      )}
      {links.backlinks.length > 0 && (
        <Section icon={<CornerUpLeftIcon className="size-3" />} label="Linked from">
          {links.backlinks.map((p) => (
            <LinkChip key={p} onClick={() => openFile(p)} label={p} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span className="flex items-center gap-1 text-muted-foreground/70">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function LinkChip({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-foreground/10",
      )}
    >
      <LinkIcon className="size-3" />
      {label}
    </button>
  );
}
