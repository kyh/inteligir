import { Row } from "./settings-chrome";

// main's copy, not the running version's tag, so a newer release the updater offers is listed too
const CHANGELOG_URL = "https://github.com/kyh/inteligir/blob/main/CHANGELOG.md";

export const VersionRow = ({ version }: { version: string | undefined }) => (
  <Row label="Version">
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-body">{version ?? "…"}</span>
      <a
        href={CHANGELOG_URL}
        target="_blank"
        rel="noreferrer"
        className="text-body text-muted-foreground underline-offset-2 hover:underline"
      >
        What&apos;s new
      </a>
    </span>
  </Row>
);
