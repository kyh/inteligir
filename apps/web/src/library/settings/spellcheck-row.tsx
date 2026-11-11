import { Switch } from "@repo/ui/components/switch";
import { PREFS, usePref } from "../prefs";
import { applySpellcheck } from "../spellcheck";
import { Row } from "./settings-chrome";

// the page's own choice, so a browser tab offers it too; the OS picks the languages
export const SpellcheckRow = () => {
  const [enabled, setEnabled] = usePref(PREFS.spellcheck);
  return (
    <Row label="Spell check">
      <span className="flex items-center gap-2">
        <Switch
          aria-label="Spell check"
          checked={enabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            applySpellcheck(next);
          }}
        />
        <span className="text-subtitle text-muted-foreground">
          {enabled ? "Underlines misspellings as you write." : "Off."}
        </span>
      </span>
    </Row>
  );
};
