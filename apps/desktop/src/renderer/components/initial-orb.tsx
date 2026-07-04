import { GeometricOrb, type DisplayStatus } from "@repo/ui/components/geometric-orb";

import { useTheme } from "@renderer/lib/use-theme";
import { useAgentStore } from "@renderer/stores/agent-store";
import type { AppState } from "@repo/features/app-state";

function phaseToOrbStatus(phase: AppState["phase"]): DisplayStatus {
  return phase === "error" ? "error" : "starting";
}

// Centered orb shown on the initial surfaces (login + onboarding). Once the
// agent is ready the shell takes over and the orb is gone — it only lives on
// these pre-app pages, so there's no docking/animation to manage anymore.
export function InitialOrb() {
  const phase = useAgentStore((s) => s.appState.phase);
  const { resolved } = useTheme();

  return (
    <div className="pointer-events-none fixed inset-0 z-30 m-auto h-44 w-44">
      <GeometricOrb
        status={phaseToOrbStatus(phase)}
        baseColor={resolved === "dark" ? "#eeeeee" : "#0a0a0a"}
      />
    </div>
  );
}
