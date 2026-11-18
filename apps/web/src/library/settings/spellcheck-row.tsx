import { Switch } from "@repo/ui/components/switch";
import { devicePrefs, usePref } from "../prefs";
import { Row } from "./settings-chrome";

export const SpellcheckRow = () => {
  const [enabled, setEnabled] = usePref(devicePrefs, "spellcheck");

  return (
    <Row label="Spell check">
      <span className="flex items-center gap-2">
        <Switch aria-label="Spell check" checked={enabled} onCheckedChange={setEnabled} />
        <span className="text-subtitle text-muted-foreground">
          {enabled ? "Underlines misspellings as you write." : "Off."}
        </span>
      </span>
    </Row>
  );
};
