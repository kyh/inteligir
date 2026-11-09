// Settings, drawn over the workspace it leaves mounted (`library-layout.tsx`): the account and
// what reaches it, bringing a library in, and how the editor reads. A section
// the cloud answers waits for a connection and says so; the editor's are this page's own.

import { Button } from "@repo/ui/components/button";
import { Separator } from "@repo/ui/components/separator";
import { useTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { ArrowLeftIcon } from "lucide-react";

import { useAppearance } from "../appearance";
import {
  EDITOR_FONTS,
  EDITOR_LEADINGS,
  EDITOR_MEASURES,
  EDITOR_SIZES,
} from "../appearance-options";
import { AccountSection } from "./account-section";
import { ImportSection } from "./import-section";
import { ChoiceRow, Row, SectionHeading } from "./settings-chrome";
import { SpellcheckRow } from "./spellcheck-row";
import { UpdatesRow } from "./updates-row";

const THEMES: readonly { value: Theme; label: string }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

// ids agree with the sections below; the nav scrolls to one rather than linking to its fragment,
// so the address stays the route
const NAV = [
  { id: "account", label: "Account" },
  { id: "import", label: "Import" },
  { id: "editor", label: "Editor" },
  { id: "about", label: "About" },
] as const;

const EditorSection = () => {
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();
  return (
    <section id="editor" className="scroll-mt-10 space-y-2">
      <SectionHeading>Editor</SectionHeading>
      <dl className="space-y-1.5">
        <Row label="Theme">
          <ChoiceRow label="Theme" options={THEMES} value={theme} onChange={setTheme} />
        </Row>
        <Row label="Editor font">
          <ChoiceRow
            label="Editor font"
            options={EDITOR_FONTS}
            value={appearance.font}
            onChange={(font) => {
              setAppearance({ ...appearance, font });
            }}
          />
        </Row>
        <Row label="Text size">
          <ChoiceRow
            label="Text size"
            options={EDITOR_SIZES}
            value={appearance.size}
            onChange={(size) => {
              setAppearance({ ...appearance, size });
            }}
          />
        </Row>
        <Row label="Line height">
          <ChoiceRow
            label="Line height"
            options={EDITOR_LEADINGS}
            value={appearance.leading}
            onChange={(leading) => {
              setAppearance({ ...appearance, leading });
            }}
          />
        </Row>
        <Row label="Measure">
          <ChoiceRow
            label="Measure"
            options={EDITOR_MEASURES}
            value={appearance.measure}
            onChange={(measure) => {
              setAppearance({ ...appearance, measure });
            }}
          />
        </Row>
        <SpellcheckRow />
      </dl>
    </section>
  );
};

export const SettingsPage = ({ onBack }: { onBack: () => void }) => (
  <div className="flex h-full min-h-0">
    <nav
      className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border p-3"
      aria-label="Settings"
    >
      <Button variant="ghost" size="compact" className="mb-2 justify-start" onClick={onBack}>
        <ArrowLeftIcon />
        Library
      </Button>
      {NAV.map((entry) => (
        <Button
          key={entry.id}
          variant="ghost"
          size="compact"
          className="justify-start text-muted-foreground"
          onClick={() => {
            document.querySelector(`#${entry.id}`)?.scrollIntoView();
          }}
        >
          {entry.label}
        </Button>
      ))}
    </nav>
    <main className="min-w-0 flex-1 space-y-6 overflow-y-auto px-8 py-6" data-settings>
      <h1 className="m-0 text-title font-medium">Settings</h1>
      <AccountSection />
      <Separator />
      <ImportSection />
      <Separator />
      <EditorSection />
      <Separator />
      <section id="about" className="scroll-mt-10 space-y-2 pb-16">
        <SectionHeading>About</SectionHeading>
        <dl className="space-y-1.5">
          <UpdatesRow />
        </dl>
      </section>
    </main>
  </div>
);
