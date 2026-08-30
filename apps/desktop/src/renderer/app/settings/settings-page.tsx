// Settings is a PAGE (/settings), not a modal — the owner's call: the
// sections outgrew a dialog twice over. The queries below still mount only
// while settings is LOOKED AT, because a route renders only when visited —
// the same property the dialog's mounted-only-while-open body used to carry
// (`useSystemStatus` has no other subscriber, so leaving this page is what
// stops the app fetching it).

import { Button } from "@repo/ui/components/button";
import { Separator } from "@repo/ui/components/separator";
import { useTheme, type Theme } from "@repo/ui/lib/theme";
import { ArrowLeftIcon } from "lucide-react";
import {
  EDITOR_FONTS,
  EDITOR_LEADINGS,
  EDITOR_MEASURES,
  EDITOR_SIZES,
  useAppearance,
} from "../appearance";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateLabel,
  useSyncNow,
  useSystemStatus,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { AgentsSection } from "./agents-section";
import { ConnectorsSection } from "./connectors-section";
import { FoldersSection } from "./folders-section";
import { NoteIntelligenceSection } from "./note-intelligence-section";
import { ChoiceRow, Row, SectionHeading } from "./settings-chrome";
import { SyncSection } from "./sync-section";
import { VoiceSection } from "./voice-section";

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The page's own map: anchor ids beside the labels the rail shows. The
 *  section HEADINGS stay inside each section component (the one-name-per-thing
 *  sweep reads those); this list only has to agree with the ids below. */
const NAV = [
  { id: "vault", label: "Vault" },
  { id: "agent", label: "Agent" },
  { id: "agents", label: "Agents" },
  { id: "connectors", label: "Connectors" },
  { id: "folders", label: "Connected folders" },
  { id: "voice", label: "Voice" },
  { id: "intelligence", label: "Note intelligence" },
  { id: "devices", label: "Devices" },
  { id: "appearance", label: "Appearance" },
  { id: "about", label: "About" },
] as const;

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();
  const systemQuery = useSystemStatus();
  const { syncNow, inFlight: syncInFlight } = useSyncNow();
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();

  const status = statusQuery.data;
  const system = systemQuery.data;

  return (
    <div className="min-h-dvh overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex max-w-3xl gap-10 px-6 py-10">
        <nav className="sticky top-10 hidden w-40 shrink-0 self-start md:block">
          <Button variant="ghost" size="sm" className="-ml-2 mb-6 gap-1.5" onClick={onBack}>
            <ArrowLeftIcon />
            Notes
          </Button>
          <ul className="space-y-1 text-sm">
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
              size="icon-sm"
              aria-label="Back to notes"
              className="md:hidden"
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </Button>
            <h2 className="text-lg font-semibold">Settings</h2>
          </header>

          <section id="vault" className="scroll-mt-10 space-y-2">
            <SectionHeading>Vault</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Location">
                <span className="block truncate font-mono text-xs" title={treeQuery.data?.root}>
                  {treeQuery.data?.root ?? "…"}
                </span>
              </Row>
              <Row label="Git remote">
                {status === undefined ? (
                  "…"
                ) : status.state === "no-remote" ? (
                  <span className="text-muted-foreground">
                    {syncBlockedReason(status)} — pair a device below to sync through your account,
                    or set INTELIGIR_VAULT_REMOTE / config.json for your own remote.
                  </span>
                ) : (
                  <span className="block truncate font-mono text-xs" title={status.remote}>
                    {status.remote}
                  </span>
                )}
              </Row>
              <Row label="Sync">
                <span className="flex items-center gap-2">
                  {status === undefined ? "…" : syncStateLabel(status)}
                  {canSyncNow(status) ? (
                    <Button variant="outline" size="xs" disabled={syncInFlight} onClick={syncNow}>
                      Sync now
                    </Button>
                  ) : null}
                </span>
                {status?.lastError !== null && status?.lastError !== undefined ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Last error: {status.lastError}
                  </span>
                ) : null}
              </Row>
            </dl>
          </section>
          <Separator />
          <section id="agent" className="scroll-mt-10 space-y-2">
            <SectionHeading>Agent</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Mode">
                <span className="font-mono text-xs">{system?.agent.mode ?? "…"}</span>
              </Row>
              <Row label="Runtime">
                <span className="font-mono text-xs">{system?.agent.runtime ?? "…"}</span>
              </Row>
              {system !== undefined && system.agent.detail !== null ? (
                <Row label="Detail">
                  <span className="text-xs text-muted-foreground">{system.agent.detail}</span>
                </Row>
              ) : null}
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
          <div id="voice" className="scroll-mt-10">
            <VoiceSection />
          </div>
          <Separator />
          <div id="intelligence" className="scroll-mt-10">
            <NoteIntelligenceSection />
          </div>
          <Separator />
          <div id="devices" className="scroll-mt-10">
            <SyncSection />
          </div>
          <Separator />
          <section id="appearance" className="scroll-mt-10 space-y-2">
            <SectionHeading>Appearance</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Theme">
                <ChoiceRow label="Theme" options={THEMES} value={theme} onChange={setTheme} />
              </Row>
              <Row label="Editor font">
                <ChoiceRow
                  label="Editor font"
                  options={EDITOR_FONTS}
                  value={appearance.font}
                  onChange={(font) => setAppearance({ ...appearance, font })}
                />
              </Row>
              <Row label="Text size">
                <ChoiceRow
                  label="Text size"
                  options={EDITOR_SIZES}
                  value={appearance.size}
                  onChange={(size) => setAppearance({ ...appearance, size })}
                />
              </Row>
              <Row label="Line height">
                <ChoiceRow
                  label="Line height"
                  options={EDITOR_LEADINGS}
                  value={appearance.leading}
                  onChange={(leading) => setAppearance({ ...appearance, leading })}
                />
              </Row>
              <Row label="Measure">
                <ChoiceRow
                  label="Measure"
                  options={EDITOR_MEASURES}
                  value={appearance.measure}
                  onChange={(measure) => setAppearance({ ...appearance, measure })}
                />
              </Row>
            </dl>
          </section>
          <Separator />
          <section id="about" className="scroll-mt-10 space-y-2 pb-16">
            <SectionHeading>About</SectionHeading>
            <dl className="space-y-1.5">
              <Row label="Version">
                <span className="font-mono text-xs">{system?.version ?? "…"}</span>
              </Row>
              <Row label="Data dir">
                <span className="block truncate font-mono text-xs" title={system?.dataDir}>
                  {system?.dataDir ?? "…"}
                </span>
              </Row>
              <Row label="Schema">
                <span className="font-mono text-xs">
                  {system === undefined ? "…" : `v${system.schemaVersion}`}
                </span>
              </Row>
              <Row label="Uptime">
                <span className="font-mono text-xs">
                  {system === undefined ? "…" : `${Math.round(system.uptimeMs / 1000)}s`}
                </span>
              </Row>
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}
