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
import {
  canSyncNow,
  syncStateLabel,
  useSyncNow,
  useSystemStatus,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { AdvancedSection } from "./advanced-section";
import { AgentsSection } from "./agents-section";
import { AttachmentsRow } from "./attachments-row";
import { ConnectorsSection } from "./connectors-section";
import { FoldersSection } from "./folders-section";
import { ChoiceRow, Row, SectionHeading } from "./settings-chrome";
import { SpellcheckRows } from "./spellcheck-rows";
import { SyncSection } from "./sync-section";
import { UpdatesRow } from "./updates-row";
import { VaultsRow } from "./vaults-rows";
import { VersionRow } from "./version-row";

const THEMES: readonly { value: Theme; label: string }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

// Ids must agree with the section anchors below.
const NAV = [
  { id: "vault", label: "Vault" },
  { id: "agents", label: "Agent" },
  { id: "connectors", label: "Connectors" },
  { id: "folders", label: "Connected folders" },
  { id: "devices", label: "Devices" },
  { id: "editor", label: "Editor" },
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
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();
  const systemQuery = useSystemStatus();
  const { syncNow, inFlight: syncInFlight } = useSyncNow();
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();

  const status = statusQuery.data;
  const system = systemQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl gap-10 px-6 py-10">
        <nav className="sticky top-10 hidden w-40 shrink-0 self-start md:block">
          <Button variant="ghost" size="compact" className="-ml-2 mb-6 gap-1.5" onClick={onBack}>
            <ArrowLeftIcon />
            Notes
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
              aria-label="Back to notes"
              className="md:hidden"
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </Button>
            <h2 className="text-title font-semibold">Settings</h2>
          </header>

          <section id="vault" className="scroll-mt-10 space-y-2">
            <SectionHeading>Vault</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Location">
                <span className="block truncate font-mono text-body" title={treeQuery.data?.root}>
                  {treeQuery.data?.root ?? "…"}
                </span>
              </Row>
              <Row label="Sync">
                <span className="flex items-center gap-2">
                  {status === undefined ? "…" : syncStateLabel(status)}
                  {canSyncNow(status) ? (
                    <Button
                      variant="tertiary"
                      size="compact"
                      disabled={syncInFlight}
                      onClick={syncNow}
                    >
                      Sync now
                    </Button>
                  ) : null}
                </span>
              </Row>
              <AttachmentsRow />
              <VaultsRow />
            </dl>
          </section>
          <Separator />
          <div id="agents" className="scroll-mt-10">
            <AgentsSection />
          </div>
          <Separator />
          <div id="connectors" className="scroll-mt-10">
            <ConnectorsSection />
          </div>
          <Separator />
          <div id="folders" className="scroll-mt-10">
            <FoldersSection />
          </div>
          <Separator />
          <div id="devices" className="scroll-mt-10">
            <SyncSection />
          </div>
          <Separator />
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
              <SpellcheckRows />
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
