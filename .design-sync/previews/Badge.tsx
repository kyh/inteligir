import { Badge } from "@repo/ui";

export function Colors() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge color="gray">Draft</Badge>
      <Badge color="blue">In Review</Badge>
      <Badge color="green">Published</Badge>
      <Badge color="amber">Pending</Badge>
      <Badge color="purple">Daily Note</Badge>
      <Badge color="red">Conflict</Badge>
    </div>
  );
}

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge variant="solid" color="green">
        Solid
      </Badge>
      <Badge variant="dot" color="green">
        Synced
      </Badge>
      <Badge variant="dot" color="amber">
        Running
      </Badge>
      <Badge variant="dot" color="gray">
        Idle
      </Badge>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge size="sm" color="blue">
        sm
      </Badge>
      <Badge size="md" color="blue">
        md
      </Badge>
      <Badge size="lg" color="blue">
        lg
      </Badge>
    </div>
  );
}
