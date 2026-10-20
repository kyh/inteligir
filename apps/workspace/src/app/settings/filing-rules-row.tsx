// Settings › Agent's way to the library's filing rules: the page Tidy my library follows. Settings
// covers the workspace, so the row writes the starter rules when the library has none, leaves the
// page for the workspace to open, and goes back to it.

import { LIBRARY_RULES_PATH } from "@repo/notes/items/item-kind";
import { Button } from "@repo/ui/components/button";

import { client, failed, isDefinedError, safe } from "../api";
import { FILING_RULES_TEXT } from "../library/filing-rules";
import { requestOpenItem } from "../open-requests";
import { Row } from "./settings-chrome";

const ensureFilingRules = async (): Promise<boolean> => {
  const [error] = await safe(
    client.vault.write({
      content: FILING_RULES_TEXT,
      guard: { kind: "absent" },
      path: LIBRARY_RULES_PATH,
    }),
  );
  if (error === null || (isDefinedError(error) && error.code === "ALREADY_EXISTS")) {
    return true;
  }
  failed(error, "The filing rules couldn't be opened.");
  return false;
};

export const FilingRulesRow = ({ onBack }: { onBack: () => void }) => (
  <dl className="pt-2">
    <Row label="Filing rules">
      <span className="flex flex-col items-start gap-1">
        <Button
          variant="tertiary"
          size="compact"
          onClick={() => {
            void (async () => {
              if (await ensureFilingRules()) {
                requestOpenItem(LIBRARY_RULES_PATH);
                onBack();
              }
            })();
          }}
        >
          Edit
        </Button>
        <span className="text-body text-muted-foreground">
          How the agent files and tags what you save when you ask it to tidy your library.
        </span>
      </span>
    </Row>
  </dl>
);
