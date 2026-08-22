// Minimal settings: what the server already answers (vault location, git
// remote, sync state, the agent block of /system/status, the connectors codex
// itself manages, the About block) plus the client-side preferences that exist
// today (theme, and what a delegation does with its writes). The remote is
// display-only — changing it rides INTELIGIR_VAULT_REMOTE / config.json until
// a config route exists.

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Separator } from "@repo/ui/components/separator";
import { useState } from "react";
import { useTheme, type Theme } from "@repo/ui/lib/theme";
import {
  EDITOR_ACCENTS,
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
  useSystemStatus,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { AgentsSection } from "./agents-section";
import { ConnectorsSection } from "./connectors-section";
import { NoteIntelligenceSection } from "./note-intelligence-section";
import { ChoiceRow, Row, SectionHeading } from "./settings-chrome";
import { SyncSection } from "./sync-section";
import { VoiceSection } from "./voice-section";

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSyncNow: () => void;
}

/**
 * The dialog is mounted for the whole session and shut for almost all of it,
 * so its three queries live in the BODY — which the dialog only renders while
 * it is open. `useSystemStatus` has no other subscriber at all, so a closed
 * dialog was the only reason this app ever fetched it.
 */
export function SettingsDialog({ open, onOpenChange, onSyncNow }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Workspace settings</DialogDescription>
        </DialogHeader>
        <SettingsBody onSyncNow={onSyncNow} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({ onSyncNow }: { onSyncNow: () => void }) {
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();
  const systemQuery = useSystemStatus();
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();

  const status = statusQuery.data;
  const system = systemQuery.data;

  return (
    // The body scrolls, not the dialog: the sections outgrew a short viewport
    // once Appearance gained a row per editor token.
    <div className="-mr-2 max-h-[70dvh] space-y-5 overflow-y-auto pr-2">
      <section className="space-y-2">
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
                {syncBlockedReason(status)} — set INTELIGIR_VAULT_REMOTE or config.json to sync.
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
                <Button variant="outline" size="xs" onClick={onSyncNow}>
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
      <section className="space-y-2">
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
      <AgentsSection />

      <ConnectorsSection />
      <Separator />
      <Separator />
      <VoiceSection />

      <NoteIntelligenceSection />
      <Separator />
      <SyncSection />
      <Separator />
      <section className="space-y-2">
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
          <Row label="Accent">
            <ChoiceRow
              label="Accent"
              options={EDITOR_ACCENTS}
              value={appearance.accent}
              onChange={(accent) => setAppearance({ ...appearance, accent })}
            />
          </Row>
        </dl>
      </section>
      <Separator />
      <section className="space-y-2">
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
    </div>
  );
}
