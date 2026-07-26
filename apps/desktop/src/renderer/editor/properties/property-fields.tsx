// Per-type controls for the file-properties panel. Each field renders one
// TypedProperty and reports edits back as a new TypedProperty (the panel turns
// that into a frontmatter-node write). Plain inputs only (v1): no date picker,
// no tag autocomplete. Text-like fields buffer locally and commit on blur/Enter
// so the document isn't re-serialized on every keystroke; checkbox and tags
// commit immediately.

import { type KeyboardEvent, useEffect, useState } from "react";
import { XIcon } from "lucide-react";

import type { TypedProperty } from "@repo/notes/markdown/frontmatter";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { cn } from "@repo/ui/lib/utils";

const FIELD_CLASS =
  "h-7 border-transparent bg-transparent px-1.5 text-sm shadow-none hover:bg-hover focus-visible:bg-card focus-visible:ring-1";

// A text-like value buffered locally; commit only real changes, on blur/Enter.
function useBuffer(value: string, commit: (next: string) => void) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return {
    value: local,
    onChange: (e: { target: { value: string } }) => setLocal(e.target.value),
    onBlur: () => {
      if (local !== value) commit(local);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setLocal(value);
        e.currentTarget.blur();
      }
    },
  };
}

export function TextField({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "text" | "date" }>;
  onChange: (next: TypedProperty) => void;
}) {
  const buffer = useBuffer(prop.value, (value) => onChange({ ...prop, value }));
  return (
    <Input
      {...buffer}
      spellCheck={false}
      placeholder={prop.type === "date" ? "YYYY-MM-DD" : "Empty"}
      className={FIELD_CLASS}
      aria-label={prop.key}
    />
  );
}

export function NumberField({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "number" }>;
  onChange: (next: TypedProperty) => void;
}) {
  const buffer = useBuffer(String(prop.value), (raw) => {
    const value = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(value)) onChange({ ...prop, value });
  });
  return <Input {...buffer} type="number" className={FIELD_CLASS} aria-label={prop.key} />;
}

export function CheckboxField({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "checkbox" }>;
  onChange: (next: TypedProperty) => void;
}) {
  return (
    <div className="flex h-7 items-center px-1.5">
      <Checkbox
        checked={prop.value}
        onCheckedChange={(value) => onChange({ ...prop, value })}
        aria-label={prop.key}
      />
    </div>
  );
}

export function TagsField({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "tags" }>;
  onChange: (next: TypedProperty) => void;
}) {
  const [draft, setDraft] = useState("");
  const commitTag = () => {
    const tag = draft.trim();
    if (tag === "" || prop.value.includes(tag)) {
      setDraft("");
      return;
    }
    onChange({ ...prop, value: [...prop.value, tag] });
    setDraft("");
  };
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 px-1.5 py-0.5">
      {prop.value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-[6px] bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange({ ...prop, value: prop.value.filter((t) => t !== tag) })}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitTag}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitTag();
          } else if (e.key === "Backspace" && draft === "" && prop.value.length > 0) {
            onChange({ ...prop, value: prop.value.slice(0, -1) });
          }
        }}
        placeholder={prop.value.length === 0 ? "Add tag" : ""}
        aria-label={`${prop.key} tags`}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

export function UnsupportedField({
  prop,
}: {
  prop: Extract<TypedProperty, { type: "unsupported" }>;
}) {
  return (
    <div className="flex min-h-7 items-center px-1.5">
      <pre
        title="Unsupported YAML — preserved byte-for-byte. Edit it in Raw mode."
        className={cn(
          "max-w-full overflow-x-auto rounded-[6px] bg-muted/60 px-1.5 py-0.5",
          "font-mono text-xs whitespace-pre text-muted-foreground",
        )}
      >
        {prop.rawYaml === "" ? "—" : prop.rawYaml}
      </pre>
    </div>
  );
}
