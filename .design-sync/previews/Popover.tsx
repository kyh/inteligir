import { Popover, PopoverTrigger, PopoverContent, Button } from "@repo/ui";
import { Info, Tag, Check } from "lucide-react";

export function NoteInfo() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="icon-sm" aria-label="Note info">
            <Info />
          </Button>
        }
      />
      <PopoverContent align="start" sideOffset={6}>
        <div style={{ width: 240, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Q3 Research Notes</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Created</span>
              <span>Jul 1, 2026</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Modified</span>
              <span>2 hours ago</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Words</span>
              <span>1,284</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Backlinks</span>
              <span>7</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TagPicker() {
  const tags = [
    { label: "research", on: true },
    { label: "planning", on: true },
    { label: "q3", on: false },
    { label: "archive", on: false },
  ];
  return (
    <Popover defaultOpen>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" leadingIcon={Tag}>
            Add tag
          </Button>
        }
      />
      <PopoverContent align="start" sideOffset={6}>
        <div style={{ width: 200, padding: 6, display: "flex", flexDirection: "column" }}>
          {tags.map((t) => (
            <button
              key={t.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "inherit",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <span>{t.label}</span>
              {t.on ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
