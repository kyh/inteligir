// The file-properties panel — typed controls over the open note's YAML
// frontmatter, hosted in the shell header's "Page details" drawer. The
// markdown file is the ONLY property store (CLAUDE.md § Decisions): there is no
// metadata DB. Edits flow through the frontmatter NODE (properties-node.ts)
// and out the editor's normal serialize path, so a property edit and a body
// edit take the exact same route to disk. Unsupported / invalid YAML is shown
// read-only and preserved byte-for-byte — the panel never destroys what it
// can't read.

import { type KeyboardEvent, useCallback, useMemo, useReducer, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { SlateEditor } from "platejs";

import {
  type ParsedProperties,
  type PropertyType,
  type TypedProperty,
  parseProperties,
  serializeProperties,
  typeNewProperty,
} from "@repo/notes/markdown/frontmatter";
import { Input } from "@repo/ui/components/input";

import {
  readFrontmatterRaw,
  writeFrontmatterRaw,
} from "@renderer/editor/properties/properties-node";
import {
  CheckboxField,
  NumberField,
  TagsField,
  TextField,
  UnsupportedField,
} from "@renderer/editor/properties/property-fields";

// Which interpretations a value can be forced into WITHOUT changing its bytes.
// Only string values are ambiguous (text vs date — both serialize the string
// verbatim); everything else has a single honest type. Overrides are
// session-only and never written to the file (they don't change the value).
function overrideOptions(prop: TypedProperty): PropertyType[] {
  return prop.type === "text" || prop.type === "date" ? ["text", "date"] : [prop.type];
}

const TYPE_LABEL: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  tags: "Tags",
  unsupported: "Unsupported",
};

function Field({
  prop,
  onChange,
}: {
  prop: TypedProperty;
  onChange: (next: TypedProperty) => void;
}) {
  switch (prop.type) {
    case "checkbox":
      return <CheckboxField prop={prop} onChange={onChange} />;
    case "number":
      return <NumberField prop={prop} onChange={onChange} />;
    case "tags":
      return <TagsField prop={prop} onChange={onChange} />;
    case "unsupported":
      return <UnsupportedField prop={prop} />;
    case "text":
    case "date":
      return <TextField prop={prop} onChange={onChange} />;
  }
}

function PropertyRow({
  prop,
  onChange,
  onDelete,
  onOverrideType,
}: {
  prop: TypedProperty;
  onChange: (next: TypedProperty) => void;
  onDelete: () => void;
  onOverrideType: (type: PropertyType) => void;
}) {
  const options = overrideOptions(prop);
  return (
    <div className="group grid grid-cols-[9rem_1fr] items-start gap-2">
      <div className="flex flex-col gap-0.5 pt-1">
        <span className="truncate text-sm text-muted-foreground" title={prop.key}>
          {prop.key}
        </span>
        {options.length > 1 && (
          // Session-only reinterpretation of a string value (text ↔ date).
          <select
            value={prop.type}
            onChange={(e) => {
              const type = e.target.value;
              if (type === "text" || type === "date") onOverrideType(type);
            }}
            aria-label={`${prop.key} type`}
            className="w-fit rounded-[4px] bg-transparent text-[10px] text-muted-foreground/70 outline-none hover:text-foreground"
          >
            {options.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Field prop={prop} onChange={onChange} />
        </div>
        <button
          type="button"
          aria-label={`Remove ${prop.key}`}
          onClick={onDelete}
          className="mt-1 rounded-[4px] px-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddProperty({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const reset = () => {
    setOpen(false);
    setKey("");
    setValue("");
  };
  const submit = () => {
    const trimmed = key.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    onAdd(trimmed, value);
    reset();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      reset();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <PlusIcon className="size-3.5" />
        Add property
      </button>
    );
  }
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
      <Input
        autoFocus
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Property"
        spellCheck={false}
        className="h-7 px-1.5 text-sm"
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={submit}
        placeholder="Value"
        spellCheck={false}
        className="h-7 px-1.5 text-sm"
      />
    </div>
  );
}

export function PropertiesPanel({ editor }: { editor: SlateEditor }) {
  // Hosted outside the Plate tree (no useEditorSelector subscription): the
  // drawer (re)mounts the panel on every open — a fresh read — and `commit`
  // bumps the tick below so the panel re-renders over its own writes.
  const [, bumpRead] = useReducer((n: number) => n + 1, 0);
  const raw = readFrontmatterRaw(editor);
  const parsed = useMemo<ParsedProperties | null>(
    () => (raw === null ? null : parseProperties(raw)),
    [raw],
  );
  // Session-only type overrides (never written to the file), keyed by property.
  const [overrides, setOverrides] = useState<Record<string, PropertyType>>({});

  const properties = parsed?.kind === "valid" ? parsed.properties : [];
  const invalid = parsed?.kind === "invalid";

  const commit = useCallback(
    (next: TypedProperty[]) => {
      writeFrontmatterRaw(editor, serializeProperties(next, raw ?? ""));
      bumpRead();
    },
    [editor, raw],
  );

  // Re-type a property under its session override before rendering its field,
  // so a "text as date" reinterpretation edits (and serializes) as a date.
  const applyOverride = (prop: TypedProperty): TypedProperty => {
    const forced = overrides[prop.key];
    if (forced === undefined || forced === prop.type) return prop;
    if (
      (prop.type === "text" || prop.type === "date") &&
      (forced === "text" || forced === "date")
    ) {
      return { key: prop.key, type: forced, value: prop.value };
    }
    return prop;
  };

  const handleChange = (index: number, nextProp: TypedProperty) => {
    const next = properties.slice();
    next[index] = nextProp;
    commit(next);
  };
  const handleDelete = (index: number) => {
    commit(properties.filter((_, i) => i !== index));
  };
  const handleAdd = (key: string, value: string) => {
    // A duplicate key would make the whole block invalid — ignore it.
    if (properties.some((p) => p.key === key)) return;
    commit([...properties, typeNewProperty(key, value)]);
  };

  if (invalid) {
    return (
      <p className="rounded-[8px] bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
        Properties unavailable — this note&rsquo;s frontmatter isn&rsquo;t a valid property list.
        Edit it in Raw mode; it&rsquo;s preserved untouched.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {properties.map((prop, index) => {
        const shown = applyOverride(prop);
        return (
          <PropertyRow
            key={prop.key}
            prop={shown}
            onChange={(nextProp) => handleChange(index, nextProp)}
            onDelete={() => handleDelete(index)}
            onOverrideType={(type) => setOverrides((prev) => ({ ...prev, [prop.key]: type }))}
          />
        );
      })}
      <AddProperty onAdd={handleAdd} />
    </div>
  );
}
