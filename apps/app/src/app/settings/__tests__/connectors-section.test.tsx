// @vitest-environment jsdom

// The connectors surface's two claims that are not the server's: the add form
// SHOWS the invocation it is about to run before it runs it, and it refuses a
// draft rather than composing a command the server would then reject.

import { connectorTarget, type Connector } from "@repo/server-contract/connectors";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddConnectorForm,
  ConnectorList,
  EMPTY_DRAFT,
  addCommandPreview,
  argumentLines,
  draftToRequest,
  type AddConnectorDraft,
} from "../connectors-section";

afterEach(cleanup);

const stdioDraft: AddConnectorDraft = {
  ...EMPTY_DRAFT,
  name: "files",
  command: "npx",
  argsText: "-y\n@modelcontextprotocol/server-everything\n",
};

describe("reading a draft", () => {
  it("takes one argument per line and drops the blanks", () => {
    expect(argumentLines("-y\n\n  /My Notes  \n")).toEqual(["-y", "/My Notes"]);
  });

  it("refuses a name codex would refuse, before the round trip", () => {
    expect(draftToRequest({ ...stdioDraft, name: "my server" })).toEqual({
      ok: false,
      problem: "A name uses letters, numbers, '-' and '_' only.",
    });
  });

  it("refuses a URL codex would store and never connect to", () => {
    expect(
      draftToRequest({ ...EMPTY_DRAFT, name: "remote", kind: "http", url: "notaurl" }).ok,
    ).toBe(false);
    expect(
      draftToRequest({ ...EMPTY_DRAFT, name: "remote", kind: "http", url: "file:///etc/passwd" })
        .ok,
    ).toBe(false);
    expect(
      draftToRequest({
        ...EMPTY_DRAFT,
        name: "remote",
        kind: "http",
        url: "https://example.test/mcp",
      }).ok,
    ).toBe(true);
  });

  it("previews the exact invocation, `--` included", () => {
    expect(addCommandPreview("files", { kind: "stdio", command: "--url", args: ["/notes"] })).toBe(
      "codex mcp add files -- --url /notes",
    );
    expect(addCommandPreview("remote", { kind: "http", url: "https://x.test/mcp" })).toBe(
      "codex mcp add remote --url https://x.test/mcp",
    );
  });
});

describe("the add form", () => {
  it("shows what it will run before it runs it", () => {
    render(
      <AddConnectorForm
        draft={stdioDraft}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        pending={false}
      />,
    );

    expect(
      screen.getByText("codex mcp add files -- npx -y @modelcontextprotocol/server-everything"),
    ).toBeDefined();
  });

  it("submits the parsed transport, not the raw text", () => {
    const onSubmit = vi.fn();
    render(
      <AddConnectorForm
        draft={stdioDraft}
        onDraftChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        pending={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add connector" }));

    expect(onSubmit).toHaveBeenCalledWith({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    });
  });

  it("says why, and offers no command, while the draft is not addable", () => {
    render(
      <AddConnectorForm
        draft={{ ...stdioDraft, command: "" }}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByText("Name the program codex should run.")).toBeDefined();
    expect(screen.queryByText(/^codex mcp add/u)).toBeNull();
  });

  it("names what an added server can reach", () => {
    render(
      <AddConnectorForm
        draft={stdioDraft}
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByText(/It can reach whatever you can/u)).toBeDefined();
  });
});

describe("the listing", () => {
  const context7: Connector = {
    name: "context7",
    enabled: true,
    transport: { kind: "http", url: "https://mcp.context7.com/mcp" },
    authStatus: "not_logged_in",
  };
  const future: Connector = {
    name: "future",
    enabled: false,
    transport: { kind: "other", summary: "quantum" },
    authStatus: null,
  };
  const servers: Connector[] = [context7, future];

  it("describes every transport, including one it cannot describe", () => {
    expect(connectorTarget({ kind: "stdio", command: "npx", args: ["-y", "x"] })).toBe("npx -y x");
    render(<ConnectorList servers={servers} onRemove={vi.fn()} pending={false} />);

    expect(screen.getByText("https://mcp.context7.com/mcp")).toBeDefined();
    expect(screen.getByText(/quantum/u)).toBeDefined();
    expect(screen.getByText("enabled · not_logged_in")).toBeDefined();
  });

  it("removes by name", () => {
    const onRemove = vi.fn();
    render(<ConnectorList servers={[context7]} onRemove={onRemove} pending={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemove).toHaveBeenCalledWith("context7");
  });

  it("says nothing is configured rather than rendering an empty list", () => {
    render(<ConnectorList servers={[]} onRemove={vi.fn()} pending={false} />);

    expect(screen.getByText("No MCP servers are configured.")).toBeDefined();
  });
});
