import { useEffect, useState } from "react";

import { getBridge } from "@/renderer/lib/bridge";
import type { SkillInfo } from "@/shared/ipc";

export function SkillsPanel() {
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

  if (skills === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }

  if (skills.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No skills installed.</div>;
  }

  return (
    <div className="flex flex-col gap-1.5 p-3">
      {skills.map((skill) => (
        <div
          key={skill.name}
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
  );
}
