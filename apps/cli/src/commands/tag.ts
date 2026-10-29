import type { ItemTagResult, ItemsTagResponse } from "@repo/contract/local/items/items-schema";
import { defineCommand } from "citty";
import { CliExitError } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// `tag add` and `tag remove` answer their one item's result, not the batch's list
export { itemTagResultSchema as tagChangeOutputSchema } from "@repo/contract/local/items/items-schema";

const singleResult = (body: ItemsTagResponse): ItemTagResult => {
  const [result] = body.results;
  if (result === undefined) {
    throw new CliExitError("The server answered no result for the item", {
      code: "UNEXPECTED_RESPONSE",
    });
  }
  return result;
};

// what the server could not do to the item is a refusal, never an answer
const refusalOf = (result: ItemTagResult): CliExitError | null => {
  if (result.outcome === "missing") {
    return new CliExitError(`${result.path} is not an item`, { code: "NOT_FOUND" });
  }
  if (result.outcome === "invalid") {
    return new CliExitError(
      `${result.path} can't be tagged: it isn't a markdown file, or its properties aren't plain`,
      { serverClass: "BAD_REQUEST" },
    );
  }
  if (result.outcome === "conflict") {
    return new CliExitError(`${result.path} kept changing while it was tagged; try again`, {
      serverClass: "CONFLICT",
    });
  }
  return null;
};

const changeArgs = {
  // citty binds positionals in declaration order.
  tag: { description: "The tag, without the #", required: true, type: "positional" },
  path: { description: "The item's path in the library", required: true, type: "positional" },
  ...jsonArg,
} as const;

export const tagCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Tag an item, untag it, or rename a tag everywhere", name: "tag" },
    subCommands: {
      add: defineCommand({
        args: changeArgs,
        meta: { description: "Add a tag to an item's properties", name: "add" },
        run: async ({ args }) => {
          const body = await apiFor(deps).items.tag({ add: [args.tag], paths: [args.path] });
          const result = singleResult(body);
          const refusal = refusalOf(result);
          if (refusal !== null) {
            throw refusal;
          }
          if (outputJson(args, result)) {
            return;
          }
          writeLines([
            result.outcome === "changed"
              ? `Tagged ${result.path} #${args.tag}`
              : `${result.path} already has #${args.tag}`,
          ]);
        },
      }),

      remove: defineCommand({
        args: changeArgs,
        meta: { description: "Take a tag off an item's properties", name: "remove" },
        run: async ({ args }) => {
          const body = await apiFor(deps).items.tag({ paths: [args.path], remove: [args.tag] });
          const result = singleResult(body);
          const refusal = refusalOf(result);
          if (refusal !== null) {
            throw refusal;
          }
          if (outputJson(args, result)) {
            return;
          }
          const inline = result.inline.some((tag) => tag.toLowerCase() === args.tag.toLowerCase());
          writeLines([
            result.outcome === "changed"
              ? `Removed #${args.tag} from ${result.path}`
              : `${result.path} has no #${args.tag} in its properties`,
            ...(inline ? [`#${args.tag} is still written in its text`] : []),
          ]);
        },
      }),

      rename: defineCommand({
        args: {
          from: { description: "The tag, without the #", required: true, type: "positional" },
          to: { description: "The new name, without the #", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Rename a tag, and the tags nested under it, in every note that holds it",
          name: "rename",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.knowledge.renameTag({ from: args.from, to: args.to });
          if (outputJson(args, body)) {
            return;
          }
          const count = body.rewritten.length;
          out.success(
            `Renamed #${body.from} to #${body.to} in ${count} note${count === 1 ? "" : "s"}.`,
          );
          for (const skip of body.skipped) {
            out.warn(`Skipped ${skip.path}: ${skip.reason}`);
          }
        },
      }),
    },
  });
