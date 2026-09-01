import { useEffect, type ReactNode } from "react";
import { Toaster, toast } from "@repo/ui";

// Toaster is the sonner container; toasts are imperative — nothing renders until
// a toast() call fires. Each cell mounts <Toaster/> and fires on mount. duration
// Infinity keeps them on screen for a static capture. NOTE: sonner uses a global
// store, so if multiple cells mount in the same document their toasts merge —
// prefer cardMode:single (see learnings). Positioned inside each bounded cell.

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        height: 260,
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--background)",
        color: "var(--foreground)",
        display: "grid",
        placeItems: "center",
        fontSize: 12,
        opacity: 1,
      }}
    >
      <span style={{ opacity: 0.4 }}>vault</span>
      {children}
    </div>
  );
}

export function Notifications() {
  useEffect(() => {
    toast.success("Note saved", { duration: Infinity });
    toast.error("Sync failed — retrying", { duration: Infinity });
    toast.info("2 backlinks updated", { duration: Infinity });
  }, []);
  return (
    <Frame>
      <Toaster position="bottom-center" expand />
    </Frame>
  );
}

export function WithDescriptionAndAction() {
  useEffect(() => {
    toast.success("Action started", {
      description: "“Summarize Q3 launch retro” — writing back to launch-retro.md",
      duration: Infinity,
      action: { label: "View", onClick: () => {} },
    });
  }, []);
  return (
    <Frame>
      <Toaster position="bottom-center" />
    </Frame>
  );
}

export function GlassToast() {
  useEffect(() => {
    toast("Action complete", {
      description: "Open the Actions panel to review the agent's edit.",
      duration: Infinity,
    });
  }, []);
  return (
    <div
      style={{
        position: "relative",
        height: 260,
        borderRadius: 12,
        overflow: "hidden",
        background: "linear-gradient(135deg, #6d5efc 0%, #b455ff 50%, #ff6ab5 100%)",
      }}
    >
      <Toaster glass position="bottom-center" />
    </div>
  );
}
