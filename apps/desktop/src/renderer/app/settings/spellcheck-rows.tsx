import { Switch } from "@repo/ui/components/switch";
import { cn } from "@repo/ui/lib/utils";
import { useState } from "react";
import type { SpellcheckState } from "../../../spellcheck-state";
import { chooseSpellcheck, useDesktopSpellcheck } from "../desktop-spellcheck";
import { failed, Row } from "./settings-chrome";

// the checked list, or the one the session would fall back to; a toggle must not leave it empty
function nextLanguages(state: SpellcheckState, code: string, on: boolean): string[] | null {
  const current = state.languages.length === 0 ? ["en-US"] : state.languages;
  if (on) return current.includes(code) ? current : [...current, code];
  const rest = current.filter((each) => each !== code);
  return rest.length === 0 ? null : rest;
}

function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// rendered only under the shell: a browser tab owns its own spell check
export function SpellcheckRows() {
  const spellcheck = useDesktopSpellcheck();
  const [pending, setPending] = useState(false);
  if (spellcheck.kind !== "state") {
    return null;
  }
  const { state } = spellcheck;
  const choose = (enabled: boolean, languages: readonly string[]): void => {
    setPending(true);
    void chooseSpellcheck({ enabled, languages: [...languages] })
      .catch((cause: unknown) => {
        failed(cause, "The spell checker did not answer.");
      })
      .finally(() => {
        setPending(false);
      });
  };
  return (
    <>
      <Row label="Spell check">
        <span className="flex items-center gap-2">
          <Switch
            aria-label="Spell check"
            checked={state.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => {
              choose(enabled, state.languages);
            }}
          />
          <span className="text-sm text-muted-foreground">
            {state.enabled ? "Underlines misspellings as you write." : "Off."}
          </span>
        </span>
      </Row>
      <Row label="Spelling languages">
        {state.languagesConfigurable ? (
          <span className="flex flex-wrap gap-1" role="group" aria-label="Spelling languages">
            {state.available.map((code) => {
              const on = state.languages.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={pending || !state.enabled}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs",
                    on
                      ? "border-ring bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                    "disabled:opacity-50",
                  )}
                  onClick={() => {
                    const languages = nextLanguages(state, code, !on);
                    if (languages !== null) choose(state.enabled, languages);
                  }}
                >
                  {languageLabel(code)}
                </button>
              );
            })}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            macOS picks the languages itself, from System Settings › Keyboard.
          </span>
        )}
      </Row>
    </>
  );
}
