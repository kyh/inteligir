import { Button } from "@repo/ui/components/button";
import { Separator } from "@repo/ui/components/separator";
import { useTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { ArrowLeftIcon } from "lucide-react";
import { useSystemStatus } from "../system-hooks";
import { AccountSection } from "./account-section";
import { AdvancedSection } from "./advanced-section";
import { ChoiceRow, Row, SectionHeading } from "./settings-chrome";
import { SpellcheckRow } from "./spellcheck-row";
import { UpdatesRow } from "./updates-row";
import { VersionRow } from "./version-row";

const THEMES: readonly { value: Theme; label: string }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

// Ids must agree with the section anchors below.
const NAV = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
] as const;

export type SettingsSection = (typeof NAV)[number]["id"];

type SystemStatus = ReturnType<typeof useSystemStatus>["data"];

const AboutSection = ({ system }: { system: SystemStatus }) => (
  <section id="about" className="scroll-mt-10 space-y-2 pb-16">
    <SectionHeading>About</SectionHeading>
    <dl className="space-y-1.5">
      <VersionRow version={system?.version} />
      <UpdatesRow />
    </dl>
  </section>
);

export const SettingsPage = ({ onBack }: { onBack: () => void }) => {
  const systemQuery = useSystemStatus();
  const { theme, setTheme } = useTheme();

  const system = systemQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl gap-10 px-6 py-10">
        <nav className="sticky top-10 hidden w-40 shrink-0 self-start md:block">
          <Button variant="ghost" size="compact" className="-ml-2 mb-6 gap-1.5" onClick={onBack}>
            <ArrowLeftIcon />
            Back
          </Button>
          <ul className="space-y-1 text-subtitle">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 space-y-8">
          <header className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Back to the workspace"
              className="md:hidden"
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </Button>
            <h2 className="text-title font-semibold">Settings</h2>
          </header>

          <div id="account" className="scroll-mt-10">
            <AccountSection />
          </div>
          <Separator />
          <section id="appearance" className="scroll-mt-10 space-y-2">
            <SectionHeading>Appearance</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Theme">
                <ChoiceRow label="Theme" options={THEMES} value={theme} onChange={setTheme} />
              </Row>
              <SpellcheckRow />
            </dl>
          </section>
          <Separator />
          <div id="advanced" className="scroll-mt-10">
            <AdvancedSection />
          </div>
          <Separator />
          <AboutSection system={system} />
        </main>
      </div>
    </div>
  );
};
