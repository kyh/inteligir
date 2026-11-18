import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { XIcon } from "lucide-react";
import { useState } from "react";

import type { TypedProperty } from "./item-properties";

export type PropertyKind = Exclude<TypedProperty["type"], "unsupported">;

type Held<K extends PropertyKind> = Extract<TypedProperty, { type: K }>["value"];

type HeldByKind = {
  readonly [K in PropertyKind]: (control: HTMLInputElement) => Held<K> | null;
};

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
  "border-transparent bg-transparent px-1.5 text-body shadow-none hover:bg-hover focus-visible:bg-card focus-visible:ring-1";

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
  const stored = String(value);

  return (
    <Input
      key={stored}
      type={type}
      defaultValue={stored}
      onBlur={(e) => {
        const next = HELD[type](e.target);

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
          e.currentTarget.value = stored;
          e.currentTarget.blur();
        }
      }}
      spellCheck={false}
      placeholder="Empty"
      className={cn("h-7", FIELD_CLASS)}
      aria-label={label}
    />
  );
};

const LinesField = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) => {
  const shown = value.replaceAll(/\r\n?/gu, "\n");

  return (
    <Textarea
      key={value}
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== shown) {
          onCommit(e.target.value);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isImeComposing(e)) {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      spellCheck={false}
      className={cn("min-h-7 py-1", FIELD_CLASS)}
      aria-label={label}
    />
  );
};

export const TextField = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) =>
  /[\n\r]/u.test(value) ? (
    <LinesField label={label} value={value} onCommit={onCommit} />
  ) : (
    <LineField label={label} type="text" value={value} onCommit={onCommit} />
  );

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
        placeholder={value.length === 0 ? "Empty" : ""}
        aria-label={label}
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
