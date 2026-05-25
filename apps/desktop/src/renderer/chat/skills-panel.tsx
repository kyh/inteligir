import { useEffect, useMemo, useState } from "react";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import type { SkillInfo } from "@/shared/ipc";

const SCOPE_LABELS: Record<string, string> = {
  user: "User",
  project: "Project",
  temporary: "Temporary",
};

function groupByScope(skills: SkillInfo[]): Map<string, SkillInfo[]> {
  const groups = new Map<string, SkillInfo[]>();
  for (const skill of skills) {
    const key = SCOPE_LABELS[skill.scope] ?? skill.scope;
    const list = groups.get(key) ?? [];
    list.push(skill);
    groups.set(key, list);
  }
  return groups;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);

  // Skills are discovered straight from disk, so they're available regardless
  // of agent lifecycle state — just fetch once on mount.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setSkills([]);
      return;
    }
    void bridge
      .listSkills()
      .then((list) => setSkills(list.skills))
      .catch(() => setSkills([]));
  }, []);

  const groups = useMemo(() => (skills ? groupByScope(skills) : null), [skills]);

  if (skills === null || groups === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }

  if (skills.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No skills installed.</div>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {[...groups.entries()].map(([scope, items]) => (
        <div key={scope} className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">{scope}</Label>
          {items.map((skill) => (
            <div
              key={skill.filePath}
              className="flex min-w-0 flex-col rounded-md border border-border px-3 py-2"
              title={skill.description}
            >
              <span className="truncate text-xs text-foreground">{skill.name}</span>
              {skill.description && (
                <span className="line-clamp-3 text-[10px] text-muted-foreground">
                  {skill.description}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
