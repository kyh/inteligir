// The phone's editor page is a file the app bundle carries, so no server stamps its policy: it is
// a meta tag in the page's own HTML, a hand copy of the server's. Held equal here, apart from the
// rows the page departs by, so a directive the server's policy adds or tightens fails until it is
// decided for the phone, rather than staying loose there.

import { buildContentSecurityPolicy } from "inteligir/server/csp";
import { describe, expect, it } from "vitest";
import { policyDirectives } from "./content-security-policy";
import { sourceOf } from "./repo";

const PAGE = "apps/mobile-editor/index.html";
const CSP = "apps/cli/src/server/csp.ts";

const META_POLICY = /http-equiv="Content-Security-Policy"\s+content="(?<policy>[^"]*)"/u;

// each directive the page spells otherwise: its own sources, or null for one it leaves out
const PAGE_DEPARTURES: ReadonlyMap<string, string | null> = new Map([
  // the page reaches nothing: the bridge is its only way out
  ["connect-src", "'none'"],
  // a policy delivered in a meta tag cannot carry it, and the WebView frames the page in nothing
  ["frame-ancestors", null],
]);

const pagePolicy = (): Record<string, string> => {
  const policy = META_POLICY.exec(sourceOf(PAGE))?.groups?.policy;
  if (policy === undefined) {
    throw new Error(`${PAGE} carries no Content-Security-Policy meta tag`);
  }
  return policyDirectives(policy);
};

describe("the phone page's content policy", () => {
  const served = policyDirectives(buildContentSecurityPolicy({ wsOrigin: null }));

  it("departs only from directives the server's policy has", () => {
    const stale = [...PAGE_DEPARTURES.keys()].filter((name) => !Object.hasOwn(served, name));
    expect(
      stale,
      `PAGE_DEPARTURES names directives ${CSP} no longer spells.\n` +
        `  fix: drop the row, or decide whether ${PAGE} keeps its own spelling of the directive\n`,
    ).toEqual([]);
  });

  it("is the server's policy for a page with no socket, apart from its departures", () => {
    const expected = Object.fromEntries(
      Object.entries(served).flatMap(([name, sources]) => {
        const departure = PAGE_DEPARTURES.get(name);
        if (departure === undefined) {
          return [[name, sources]];
        }
        return departure === null ? [] : [[name, departure]];
      }),
    );
    expect(
      pagePolicy(),
      `${PAGE}'s meta CSP is not ${CSP}'s for a page with no socket.\n` +
        `  rule: the page loads from the phone's own disk, so its policy is a copy of the server's, and every directive is the server's or a PAGE_DEPARTURES row with its reason\n` +
        `  fix: spell the server's change in ${PAGE}, or add a row saying why the phone departs from it\n`,
    ).toEqual(expected);
  });
});
