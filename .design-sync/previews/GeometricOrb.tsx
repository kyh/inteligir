import { type ReactNode } from "react";
import { GeometricOrb } from "@repo/ui";

// GeometricOrb is a react-three-fiber WebGL canvas. It fills its parent, so every
// cell gives it an explicit pixel box. Idle/starting strands use baseColor
// (#eeeeee) which only reads on a dark fill — so each orb sits on a dark stage,
// matching how the desktop shell docks it. WebGL may not paint in a headless
// iframe; if these render blank, fall back to the floor card (see learnings).

function Stage({ size, label, children }: { size: number; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
          background: "radial-gradient(120% 120% at 50% 30%, #17171d 0%, #0a0a0e 100%)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
      <span style={{ fontSize: 12, opacity: 0.6 }}>{label}</span>
    </div>
  );
}

export function Statuses() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <Stage size={120} label="idle">
        <GeometricOrb status="idle" />
      </Stage>
      <Stage size={120} label="busy">
        <GeometricOrb status="busy" />
      </Stage>
      <Stage size={120} label="listening">
        <GeometricOrb status="listening" />
      </Stage>
      <Stage size={120} label="speaking">
        <GeometricOrb status="speaking" />
      </Stage>
      <Stage size={120} label="error">
        <GeometricOrb status="error" />
      </Stage>
    </div>
  );
}

export function SizesAndTuning() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-end" }}>
      <Stage size={200} label="hero — 20 strands">
        <GeometricOrb status="listening" numLines={20} lineWidth={2} />
      </Stage>
      <Stage size={96} label="dock — 10 strands">
        <GeometricOrb status="busy" numLines={10} lineWidth={1.5} />
      </Stage>
      <Stage size={64} label="badge — 8 strands">
        <GeometricOrb status="idle" numLines={8} lineWidth={1.5} />
      </Stage>
    </div>
  );
}
