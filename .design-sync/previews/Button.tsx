import { Button } from "@repo/ui";
import { ArrowRight, Plus, Trash2, Check } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Button variant="primary" leadingIcon={Plus}>
        New note
      </Button>
      <Button variant="secondary" trailingIcon={ArrowRight}>
        Continue
      </Button>
      <Button variant="destructive" leadingIcon={Trash2}>
        Delete
      </Button>
    </div>
  );
}

export function IconOnly() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Button size="icon-sm" variant="secondary" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon" variant="secondary" aria-label="Confirm">
        <Check />
      </Button>
      <Button size="icon-lg" variant="tertiary" aria-label="Delete">
        <Trash2 />
      </Button>
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Button loading>Saving</Button>
      <Button disabled>Disabled</Button>
      <Button active>Active</Button>
    </div>
  );
}
