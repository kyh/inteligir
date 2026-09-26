// @vitest-environment jsdom

// The connectors section's own halves: the draft→request gate (the disabled state and the submit
// read one answer), the presets the one-click rows add, the poll that waits out a sign-in, and what
// a row offers in each state.

import { connectorAddRequestSchema } from "@repo/api/local/connectors/connectors-schema";
import type { ConnectorView } from "@repo/api/local/connectors/connectors-schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONNECTOR_PRESETS } from "../connector-presets";
import {
  argumentLines,
  ConnectorRow,
  draftToRequest,
  EMPTY_DRAFT,
  offersSignIn,
  signInPollInterval,
} from "../connectors-section";

afterEach(cleanup);

const URL_ROW: ConnectorView = {
  auth: "unknown",
  name: "linear",
  signIn: { state: "idle" },
  target: { kind: "http", url: "https://mcp.linear.app/mcp" },
};

const STDIO_ROW: ConnectorView = {
  auth: "not-needed",
  name: "files",
  signIn: { state: "idle" },
  target: { args: ["-y", "server"], command: "npx", kind: "stdio" },
};

describe("draftToRequest", () => {
  it("refuses a name outside the grammar, and says which rule", () => {
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "bad name", url: "https://x.dev" })).toEqual({
      ok: false,
      problem:
        "The name must start with a letter or number and use letters, numbers, '-' and '_' only.",
    });
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "-flag", url: "https://x.dev" }).ok).toBe(false);
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "a".repeat(65), url: "https://x.dev" })).toEqual({
      ok: false,
      problem: "The name is at most 64 characters.",
    });
  });

  it("takes a URL that parses as http(s) and nothing else", () => {
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "docs", url: " https://x.dev/mcp " })).toEqual({
      name: "docs",
      ok: true,
      target: { kind: "http", url: "https://x.dev/mcp" },
    });
    expect(draftToRequest({ ...EMPTY_DRAFT, name: "docs", url: "ftp://x.dev" })).toEqual({
      ok: false,
      problem: "The URL must be an http:// or https:// URL.",
    });
  });

  it("builds a command from its argument lines", () => {
    expect(
      draftToRequest({
        ...EMPTY_DRAFT,
        argsText: "-y\nserver-files\n\n",
        command: "npx",
        kind: "stdio",
        name: "files",
      }),
    ).toEqual({
      name: "files",
      ok: true,
      target: { args: ["-y", "server-files"], command: "npx", kind: "stdio" },
    });
    expect(draftToRequest({ ...EMPTY_DRAFT, kind: "stdio", name: "files" })).toEqual({
      ok: false,
      problem: "Fill in the command.",
    });
  });

  it("splits arguments on lines and drops blanks", () => {
    expect(argumentLines(" a \n\nb\n")).toEqual(["a", "b"]);
  });
});

describe("the presets", () => {
  it("are each an add the server takes, under a name of their own", () => {
    for (const preset of CONNECTOR_PRESETS) {
      expect(
        connectorAddRequestSchema.safeParse({
          name: preset.name,
          target: { kind: "http", url: preset.url },
        }).success,
        preset.name,
      ).toBe(true);
    }
    expect(new Set(CONNECTOR_PRESETS.map((preset) => preset.name)).size).toBe(
      CONNECTOR_PRESETS.length,
    );
  });
});

describe("signInPollInterval", () => {
  it("polls only while a row waits on a sign-in", () => {
    expect(
      signInPollInterval([
        URL_ROW,
        { ...URL_ROW, name: "b", signIn: { state: "pending", url: null } },
      ]),
    ).toBeGreaterThan(0);
    expect(signInPollInterval([URL_ROW, STDIO_ROW])).toBe(false);
    expect(signInPollInterval([])).toBe(false);
  });
});

const noop = (): void => {
  /* empty */
};

describe("a connector row", () => {
  it("offers a sign-in to a URL that may need one, and to nothing else", () => {
    expect(offersSignIn(URL_ROW)).toBe(true);
    expect(offersSignIn({ ...URL_ROW, auth: "needs-sign-in" })).toBe(true);
    expect(offersSignIn({ ...URL_ROW, auth: "signed-in" })).toBe(false);
    expect(offersSignIn({ ...URL_ROW, auth: "not-needed" })).toBe(false);
    expect(offersSignIn({ ...URL_ROW, signIn: { state: "pending", url: null } })).toBe(false);
    expect(offersSignIn(STDIO_ROW)).toBe(false);
  });

  it("waits on the browser with the sign-in page as a fallback link", () => {
    const url = "https://auth.test/authorize";
    render(
      <ConnectorRow
        server={{ ...URL_ROW, signIn: { state: "pending", url } }}
        busy={false}
        onSignIn={noop}
        onRemove={noop}
      />,
    );
    expect(screen.getByText("Finish signing in in your browser.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Open the sign-in page" }).getAttribute("href")).toBe(
      url,
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("says why a sign-in failed, and offers it again", () => {
    render(
      <ConnectorRow
        server={{ ...URL_ROW, signIn: { detail: "the provider refused", state: "failed" } }}
        busy={false}
        onSignIn={noop}
        onRemove={noop}
      />,
    );
    expect(screen.getByText("the provider refused")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
  });

  it("names a command row by what it runs, with nothing to sign in to", () => {
    render(<ConnectorRow server={STDIO_ROW} busy={false} onSignIn={noop} onRemove={noop} />);
    expect(screen.getByText("npx -y server")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
  });
});
