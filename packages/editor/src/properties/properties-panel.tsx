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

import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import {
  CheckboxField,
  NumberField,
  TagsField,
  TextField,
  UnsupportedField,
} from "@repo/editor/properties/property-fields";

// only strings are ambiguous (text and date serialize identically); overrides are session-only.
function overrideOptions(prop: TypedProperty): PropertyType[] {
  return prop.type === "text" || prop.type === "date" ? ["text", "date"] : [prop.type];
}

const TYPE_LABEL = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  tags: "Tags",
  unsupported: "Unsupported",
} satisfies Record<PropertyType, string>;

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
  // no useEditorSelector: the drawer remounts the panel on each open, and `commit` bumps
  // the tick to re-render over its own writes.
  const [, bumpRead] = useReducer((n: number) => n + 1, 0);
  const raw = readFrontmatterRaw(editor);
  const parsed = useMemo<ParsedProperties | null>(
    () => (raw === null ? null : parseProperties(raw)),
    [raw],
  );
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
    // a duplicate key would make the whole block invalid.
    if (properties.some((p) => p.key === key)) return;
    commit([...properties, typeNewProperty(key, value)]);
  };

  if (invalid) {
    return (
      <p className="rounded-[8px] bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
        Properties unavailable — this note&rsquo;s frontmatter isn&rsquo;t a valid property list.
        It&rsquo;s preserved untouched; edit it in the document.
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
