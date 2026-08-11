import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";
import { cn } from "@repo/ui/lib/utils";

import {
  ACCENT_KEYS,
  ACCENTS,
  CHROME_CONTRAST,
  EDITOR_FONT_KEYS,
  EDITOR_FONTS,
  FONT_SIZE,
  LINE_HEIGHT,
  MONO_FONT_KEYS,
  MONO_FONTS,
  parseAppearance,
  type NumericRange,
} from "@repo/workspace/appearance/appearance";
import { useAppearance } from "@repo/workspace/appearance/use-appearance";
import { SegmentedControl } from "@repo/workspace/components/segmented-control";
import { useTheme, type Theme } from "@repo/workspace/lib/use-theme";

const THEME_OPTIONS: readonly { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

const WIDTH_OPTIONS = [
  { value: "narrow", label: "Reading column" },
  { value: "full", label: "Full width" },
] as const;

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-foreground">{label}</span>
        {hint !== undefined && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A native range, so the accent colours the track for free and there is no
 * component to maintain. The live value is the label. */
function RangeRow({
  label,
  range,
  value,
  format,
  onChange,
}: {
  label: string;
  range: NumericRange;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Row label={label} hint={format(value)}>
      <input
        type="range"
        aria-label={label}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        className="w-40 accent-[var(--accent-color)]"
      />
    </Row>
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance, resetAppearance } = useAppearance();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">Appearance</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetAppearance}
          className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          Reset
        </Button>
      </div>

      <SegmentedControl
        options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
          value,
          label: (
            <>
              <Icon className="size-3.5" />
              {label}
            </>
          ),
        }))}
        value={theme}
        onChange={setTheme}
        className="grid-cols-3"
        optionClassName="flex flex-col items-center gap-1 text-[10px]"
      />

      <div className="divide-y divide-border rounded-[10px] bg-muted">
        <Row label="Accent">
          <div className="flex items-center gap-1.5">
            {ACCENT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={ACCENTS[key].label}
                aria-pressed={appearance.accent === key}
                title={ACCENTS[key].label}
                onClick={() => setAppearance({ accent: key })}
                style={{ backgroundColor: ACCENTS[key].color }}
                className={cn(
                  "size-5 rounded-full ring-offset-2 ring-offset-muted transition-shadow",
                  appearance.accent === key && "ring-2 ring-foreground/40",
                )}
              />
            ))}
          </div>
        </Row>

        <Row label="Editor font">
          <NativeSelect
            size="sm"
            aria-label="Editor font"
            value={appearance.editorFont}
            onChange={(e) =>
              setAppearance(parseAppearance({ ...appearance, editorFont: e.currentTarget.value }))
            }
          >
            {EDITOR_FONT_KEYS.map((key) => (
              <NativeSelectOption key={key} value={key}>
                {EDITOR_FONTS[key].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>

        <Row label="Code font" hint="Code blocks and markdown editing">
          <NativeSelect
            size="sm"
            aria-label="Code font"
            value={appearance.monoFont}
            onChange={(e) =>
              setAppearance(parseAppearance({ ...appearance, monoFont: e.currentTarget.value }))
            }
          >
            {MONO_FONT_KEYS.map((key) => (
              <NativeSelectOption key={key} value={key}>
                {MONO_FONTS[key].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>

        <RangeRow
          label="Font size"
          range={FONT_SIZE}
          value={appearance.fontSize}
          format={(v) => `${String(v)}px`}
          onChange={(fontSize) => setAppearance({ fontSize })}
        />

        <RangeRow
          label="Line height"
          range={LINE_HEIGHT}
          value={appearance.lineHeight}
          format={(v) => v.toFixed(1)}
          onChange={(lineHeight) => setAppearance({ lineHeight })}
        />

        <Row label="Editor width">
          <SegmentedControl
            options={WIDTH_OPTIONS}
            value={appearance.editorWidth}
            onChange={(editorWidth) => setAppearance({ editorWidth })}
            className="grid-cols-2 text-[10px]"
          />
        </Row>

        <RangeRow
          label="Contrast"
          range={CHROME_CONTRAST}
          value={appearance.chromeContrast}
          format={(v) => `${String(v)}%`}
          onChange={(chromeContrast) => setAppearance({ chromeContrast })}
        />
      </div>
    </div>
  );
}
