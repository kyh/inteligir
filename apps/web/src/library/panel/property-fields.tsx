import type { PropertyType, TypedProperty } from "@repo/editor/markdown/frontmatter";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { XIcon } from "lucide-react";
import { useRef, useState } from "react";

export type PropertyKind = Exclude<PropertyType, "unsupported">;
type Held<K extends PropertyKind> = Extract<TypedProperty, { type: K }>["value"];
type HeldByKind = {
  readonly [K in PropertyKind]: (control: HTMLInputElement) => Held<K> | null;
};

// What each type's control holds, as that type's value: nothing is inferred from how it reads, and
// a control holding none of its type (a number or a date left empty) answers null.
export const HELD: HeldByKind = {
  checkbox: (control) => control.checked,
  date: (control) => (control.value === "" ? null : control.value),
  number: (control) => (Number.isFinite(control.valueAsNumber) ? control.valueAsNumber : null),
  tags: (control) =>
    control.value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  text: (control) => control.value,
};

const FIELD_CLASS =
  "h-7 border-transparent bg-transparent px-1.5 text-body shadow-none hover:bg-hover focus-visible:bg-card focus-visible:ring-1";

// One line of a property, edited where it stands. Uncontrolled and keyed by the stored value, so
// a newer one redraws it; leaving it writes what was typed, and Escape, or a control left holding
// none of its type, shows the stored value again.
export const LineField = <K extends "text" | "date" | "number">({
  label,
  type,
  value,
  onCommit,
}: {
  label: string;
  type: K;
  value: Held<K>;
  onCommit: (next: Held<K>) => void;
}) => {
  // an input shows a stored line break as none, so only a line someone typed in is read back
  const typed = useRef(false);
  const stored = String(value);
  return (
    <Input
      key={stored}
      type={type}
      defaultValue={stored}
      onChange={() => {
        typed.current = true;
      }}
      onBlur={(e) => {
        const next = typed.current ? HELD[type](e.target) : null;
        typed.current = false;
        if (next === null) {
          e.target.value = stored;
        } else if (next !== value) {
          onCommit(next);
        }
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) {
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          typed.current = false;
          e.currentTarget.blur();
        }
      }}
      spellCheck={false}
      placeholder="Empty"
      className={FIELD_CLASS}
      aria-label={label}
    />
  );
};

export const CheckboxField = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean;
  onCommit: (next: boolean) => void;
}) => (
  <div className="flex h-7 items-center px-1.5">
    <Checkbox checked={value} onCheckedChange={onCommit} aria-label={label} />
  </div>
);

export const TagsField = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: readonly string[];
  onCommit: (next: string[]) => void;
}) => {
  const [draft, setDraft] = useState("");
  const commitTag = () => {
    const tag = draft.trim();
    if (tag !== "" && !value.includes(tag)) {
      onCommit([...value, tag]);
    }
    setDraft("");
  };
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 px-1.5 py-0.5">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-[6px] bg-muted px-1.5 py-0.5 text-caption text-foreground"
        >
          {tag}
          <Tooltip content={`Remove ${tag}`}>
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => {
                onCommit(value.filter((t) => t !== tag));
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </Tooltip>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commitTag}
        onKeyDown={(e) => {
          if (isImeComposing(e)) {
            return;
          }
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitTag();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onCommit(value.slice(0, -1));
          }
        }}
        placeholder={value.length === 0 ? "Add tag" : ""}
        aria-label={`${label} tags`}
        className="min-w-16 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
};

export const UnsupportedField = ({ raw }: { raw: string }) => (
  <div className="flex min-h-7 items-center px-1.5">
    <pre
      title="This value can't be edited here."
      className={cn(
        "max-w-full overflow-x-auto rounded-[6px] bg-muted/60 px-1.5 py-0.5",
        "font-mono text-body whitespace-pre text-muted-foreground",
      )}
    >
      {raw}
    </pre>
  </div>
);
