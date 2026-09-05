import { describe, expect, it } from "vitest";
import {
  createSpellcheck,
  languagesConfigurableOn,
  planSpellcheck,
  senderIsWindow,
  type SpellcheckPort,
} from "../spellcheck";

function fakePort(available: string[]): SpellcheckPort & { calls: string[] } {
  let enabled = true;
  let languages = ["en-US"];
  const port: SpellcheckPort & { calls: string[] } = {
    calls: [],
    availableLanguages: () => available,
    isEnabled: () => enabled,
    languages: () => languages,
    setEnabled(next) {
      port.calls.push(`enabled:${String(next)}`);
      enabled = next;
    },
    setLanguages(next) {
      port.calls.push(`languages:${next.join(",")}`);
      languages = [...next];
    },
  };
  return port;
}

describe("the plan", () => {
  it("keeps only languages the session offers", () => {
    expect(
      planSpellcheck({ enabled: true, languages: ["en-GB", "xx-XX"] }, ["en-US", "en-GB"]),
    ).toEqual({ enabled: true, languages: ["en-GB"] });
  });

  it("leaves the session's list alone when nothing chosen is on offer", () => {
    expect(planSpellcheck({ enabled: false, languages: ["xx-XX"] }, ["en-US"])).toEqual({
      enabled: false,
      languages: null,
    });
    expect(planSpellcheck({ enabled: true, languages: [] }, ["en-US"]).languages).toBeNull();
  });
});

describe("applying a choice", () => {
  it("sets the switch and the languages where the platform honours them", () => {
    const port = fakePort(["en-US", "de-DE"]);
    const spellcheck = createSpellcheck({ port, platform: "linux" });
    const state = spellcheck.apply({ enabled: false, languages: ["de-DE"] });
    expect(port.calls).toEqual(["enabled:false", "languages:de-DE"]);
    expect(state).toEqual({
      enabled: false,
      languages: ["de-DE"],
      available: ["en-US", "de-DE"],
      languagesConfigurable: true,
    });
  });

  it("on macOS sets the switch alone and says the list is not its to change", () => {
    const port = fakePort(["en-US", "de-DE"]);
    const spellcheck = createSpellcheck({ port, platform: "darwin" });
    const state = spellcheck.apply({ enabled: false, languages: ["de-DE"] });
    expect(port.calls).toEqual(["enabled:false"]);
    expect(state.languagesConfigurable).toBe(false);
    expect(languagesConfigurableOn("win32")).toBe(true);
  });
});

describe("the channel guard", () => {
  it("answers only the window that took the bridge", () => {
    const contents = {};
    expect(senderIsWindow(contents, { webContents: contents })).toBe(true);
    expect(senderIsWindow({}, { webContents: contents })).toBe(false);
    expect(senderIsWindow(contents, null)).toBe(false);
  });
});
