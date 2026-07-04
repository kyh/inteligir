import { Spinner } from "@repo/ui";

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Spinner width={16} height={16} />
      <Spinner width={24} height={24} />
      <Spinner width={32} height={32} />
    </div>
  );
}

export function Inline() {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontSize: 13,
        color: "var(--muted-foreground)",
      }}
    >
      <Spinner width={16} height={16} />
      Delegating task to background agent…
    </div>
  );
}

export function Colors() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Spinner width={24} height={24} style={{ color: "var(--foreground)" }} />
      <Spinner width={24} height={24} style={{ color: "#6B97FF" }} />
      <Spinner width={24} height={24} style={{ color: "var(--muted-foreground)" }} />
    </div>
  );
}
