// The contract's rows `/v1/rpc` does not serve yet, which every area that lands its rows strikes
// from the list; once it is empty, the router is `os.router(v1Contract)` and this file goes.

import { v1Contract } from "@repo/contract/rpc/v1-contract";
import { walkProcedureContractsSync } from "@orpc/server";
import { expect, it } from "vitest";

import { v1Router } from "./v1-rpc";

const pathsOf = (router: Parameters<typeof walkProcedureContractsSync>[0]): string[] => {
  const paths: string[] = [];
  walkProcedureContractsSync(router, (_procedure, path) => {
    paths.push(path.join("."));
  });
  return paths;
};

it("routes only rows the contract declares", () => {
  const declared = new Set(pathsOf(v1Contract));
  expect(pathsOf(v1Router).filter((path) => !declared.has(path))).toStrictEqual([]);
});

it("names every row not routed yet", () => {
  const routed = new Set(pathsOf(v1Router));
  expect(pathsOf(v1Contract).filter((path) => !routed.has(path))).toMatchInlineSnapshot(`
    [
      "account.socketTicket",
      "account.assistants.list",
      "account.assistants.revoke",
      "library.agent.send",
      "library.agent.respond",
      "library.agent.cancel",
      "library.agent.list",
      "library.agent.events",
      "library.agent.delete",
      "library.agent.status",
      "library.agent.setEnabled",
      "library.agent.rules",
      "library.agent.setRules",
      "library.agent.undoable",
      "library.agent.undo",
      "library.folders.write",
      "library.guide",
      "library.imports.settle",
      "library.imports.named",
      "library.imports.land",
      "library.items.list",
      "library.items.read",
      "library.items.get",
      "library.items.row",
      "library.items.create",
      "library.items.createNote",
      "library.items.createFile",
      "library.items.save",
      "library.items.saveLink",
      "library.items.edit",
      "library.items.organize",
      "library.items.delete",
      "library.items.restore",
      "library.items.purge",
      "library.items.sweep",
      "library.items.refresh",
      "library.listing.page",
      "library.listing.scopes",
      "library.listing.titles",
      "library.organize.outline",
      "library.search",
      "library.write",
    ]
  `);
});
