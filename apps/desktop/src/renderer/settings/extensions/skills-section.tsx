// Skills are read-only — discovered from disk by pi at startup. The agent
// uses them as prompting/guidance, distinct from tools (which take arguments).

import { useEffect, useMemo, useState } from "react";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import type { SkillInfo } from "@repo/features/ipc";

const SKILL_SCOPE_LABELS: Record<string, string> = {
  user: "User",
  project: "Project",
  temporary: "Temporary",
};

function groupSkillsByScope(skills: SkillInfo[]): Map<string, SkillInfo[]> {
  const groups = new Map<string, SkillInfo[]>();
  for (const skill of skills) {
    const key = SKILL_SCOPE_LABELS[skill.scope] ?? skill.scope;
    const list = groups.get(key) ?? [];
    list.push(skill);
    groups.set(key, list);
  }
  return groups;
}

export function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);

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

  const groups = useMemo(() => (skills ? groupSkillsByScope(skills) : null), [skills]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Skills</Label>
      {skills === null || groups === null ? (
        <div className="text-[10px] text-muted-foreground">Loading…</div>
      ) : skills.length === 0 ? (
        <div className="rounded-[10px] bg-muted px-3 py-2 text-[10px] text-muted-foreground">
          No skills installed.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {[...groups.entries()].map(([scope, items]) => (
            <div key={scope} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {scope}
              </span>
              {items.map((skill) => (
                <div
                  key={skill.filePath}
                  className="flex min-w-0 flex-col rounded-[10px] bg-muted px-3 py-2"
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
      )}
    </div>
  );
}
