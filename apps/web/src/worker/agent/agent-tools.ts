// The built-in agent's tools: the library's own procedures, the rows the connector serves as tools
// (`../connector/library-tools`) whose name `AGENT_TOOL_POLICIES` allows, each defined as the Messages
// API takes a tool, by its name, its description and its input's JSON Schema less the `opId` the
// cell mints itself. The definitions are built once and sorted by name: their bytes are every new
// thread's cached prefix (a committed snapshot holds them). The cell runs a call
// (`runAgentTool`) through its own router, as a client call would land, its write's op id derived
// from the call's id, so a call run again after an eviction answers what it first answered. An
// answer is its JSON, at most 40,000 characters: it is replayed into every later call of its
// conversation, so a paged list is asked again at half its rows until it fits, and what still does
// not is refused, a read told to ask for less and a write that it landed. A refusal or a failure is
// a result the agent reads, never a failed turn.

import { getOpenAPIMeta } from "@orpc/openapi";
import { call, getRouter, ORPCError, Procedure, walkProcedureContractsSync } from "@orpc/server";
import type { AnyProcedure, AnyRouter, Context, ProcedureClientInterceptor } from "@orpc/server";
import type { AnySchema, ErrorMap } from "@orpc/contract";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { sha256Hex } from "@repo/contract/cloud/bytes";
import { PAGE_MAX } from "@repo/contract/cloud/library/library-wire";
import { z } from "zod";

import { isLibraryTool, libraryTools } from "../connector/library-tools";
import { AGENT_TOOL_POLICIES, isAgentToolName } from "./library-agent";
import type { AgentToolName } from "./library-agent";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

// what one result may carry: its JSON as the tool_result's text
/** @internal */
export const AGENT_RESULT_MAX_CHARS = 40_000;

// the property a write's input carries its op id in, which the agent never writes
const OP_ID = "opId";

const jsonObjectSchema = z.record(z.string(), z.json());

// a row's input schema: the one its contract declares, or none, which takes an empty object
const zodOf = (schemas: readonly AnySchema[] | undefined): z.ZodType => {
  const [schema, ...more] = schemas ?? [];
  if (more.length > 0) {
    throw new Error("a library tool declares one input schema");
  }
  return schema instanceof z.ZodType ? schema : z.strictObject({});
};

const requiredSchema = z.array(z.string()).optional();
const propertiesSchema = z.record(z.string(), z.json()).optional();

// the row's input as the model writes it: its JSON Schema, the op id left out
const toolInputSchema = (input: z.ZodType): BetaTool["input_schema"] => {
  const json = jsonObjectSchema.parse(z.toJSONSchema(input, { io: "input" }));
  const properties = propertiesSchema.parse(json.properties) ?? {};
  const required = requiredSchema.parse(json.required) ?? [];
  const kept = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== OP_ID));
  const rest = Object.fromEntries(
    Object.entries(json).filter(
      ([key]) => key !== "$schema" && key !== "properties" && key !== "required" && key !== "type",
    ),
  );
  const named = required.filter((key) => key !== OP_ID);
  const schema: BetaTool["input_schema"] = { ...rest, properties: kept, type: "object" };
  if (named.length > 0) {
    schema.required = named;
  }
  return schema;
};

interface AgentToolRow {
  readonly name: AgentToolName;
  readonly path: readonly string[];
  readonly definition: BetaTool;
  // whether its input takes an op id, which a write's does
  readonly writes: boolean;
}

const takesOpId = (input: z.ZodType): boolean =>
  input instanceof z.ZodObject && Object.hasOwn(input.shape, OP_ID);

const agentToolRows = (): AgentToolRow[] => {
  const rows: AgentToolRow[] = [];
  walkProcedureContractsSync(libraryTools, (contract, path) => {
    const meta = getOpenAPIMeta(contract);
    const name = meta?.operationId;
    if (!isLibraryTool(contract) || name === undefined || !isAgentToolName(name)) {
      return;
    }
    const input = zodOf(contract["~orpc"].inputSchemas);
    rows.push({
      definition: {
        description: meta?.description ?? "",
        input_schema: toolInputSchema(input),
        name,
      },
      name,
      path,
      writes: takesOpId(input),
    });
  });
  return rows.toSorted((left, right) => left.name.localeCompare(right.name));
};

const AGENT_TOOL_ROWS = agentToolRows();

// what every thread sends as its tools, sorted by name, the same bytes for every account
export const AGENT_TOOL_DEFINITIONS: readonly BetaTool[] = AGENT_TOOL_ROWS.map(
  (row) => row.definition,
);

// whether a call waits on the person before it runs
export const asksFirst = (name: string): boolean =>
  isAgentToolName(name) && AGENT_TOOL_POLICIES[name] === "ask";

// ---- running a call, in the cell ----

const limitedSchema = z.looseObject({ limit: z.number().int().positive().optional() });

// whether a row pages a list: its input takes a `limit`
const isPaged = (procedure: AnyProcedure): boolean =>
  (procedure["~orpc"].inputSchemas ?? []).some(
    (schema) => schema instanceof z.ZodObject && Object.hasOwn(schema.shape, "limit"),
  );

const TOO_LONG_TO_READ =
  "That answer is too long to read at once. Ask for fewer rows with limit, the concise format, or a smaller range of blocks.";
const TOO_LONG_TO_SHOW =
  "That change was made, but its answer is too long to show. Read the items again to see them.";

// a result past what the agent takes whole: a list asked for again at half its rows until it fits,
// so it answers what fits and the cursor for the rest; one no smaller page fits is refused, a
// read's saying to ask for less and a write's that it landed
const fitAgentResult: ProcedureClientInterceptor<Context, AnySchema, ErrorMap> = async (
  options,
) => {
  let output: unknown = await options.next();
  const limited = limitedSchema.safeParse(options.input);
  if (isPaged(options.procedure) && limited.success) {
    const page = limited.data;
    let limit = page.limit ?? PAGE_MAX;
    while (JSON.stringify(output ?? null).length > AGENT_RESULT_MAX_CHARS && limit > 1) {
      limit = Math.floor(limit / 2);
      output = await options.next({ ...options, input: { ...page, limit } });
    }
  }
  if (JSON.stringify(output ?? null).length <= AGENT_RESULT_MAX_CHARS) {
    return output;
  }
  throw new ORPCError("PAYLOAD_TOO_LARGE", {
    message:
      getOpenAPIMeta(options.procedure)?.method === "GET" ? TOO_LONG_TO_READ : TOO_LONG_TO_SHOW,
  });
};

export interface AgentToolResult {
  readonly content: string;
  readonly isError: boolean;
}

const issuesSchema = z.object({
  issues: z.array(z.looseObject({ message: z.string(), path: z.array(z.unknown()).optional() })),
});

// a refusal in words the agent acts on: its message, and for input it could not read, where
const errorText = (error: ORPCError<string, unknown>): string => {
  const issues = issuesSchema.safeParse(error.data);
  if (!issues.success || issues.data.issues.length === 0) {
    return error.message;
  }
  const lines = issues.data.issues.map(
    (issue) => `${(issue.path ?? []).map(String).join(".") || "input"}: ${issue.message}`,
  );
  return `${error.message}\n${lines.join("\n")}`;
};

// the router's implementation of a row, by its path
const procedureAt = (router: AnyRouter, path: readonly string[]): AnyProcedure | null => {
  const found = getRouter(router, path);
  return found instanceof Procedure ? found : null;
};

// the op id a call's write keeps, a UUID read off the hash of `agent:<threadId>:<toolUseId>`, so
// the same call lands once however often it is run
/** @internal */
export const agentOpId = async (threadId: string, toolUseId: string): Promise<string> => {
  const hex = await sha256Hex(`agent:${threadId}:${toolUseId}`);
  // version 8 (RFC 9562 § 5.8) and the RFC's variant over the hash's own bits
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) % 4) + 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export interface AgentToolCall {
  readonly threadId: string;
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
}

// one call run through the router as `context`'s actor, its answer as the agent reads it
export const runAgentTool = async (
  router: AnyRouter,
  context: Context,
  request: AgentToolCall,
): Promise<AgentToolResult> => {
  const row = AGENT_TOOL_ROWS.find((candidate) => candidate.name === request.name);
  const procedure = row === undefined ? null : procedureAt(router, row.path);
  if (row === undefined || procedure === null) {
    return { content: `There is no tool named ${request.name}.`, isError: true };
  }
  const given = jsonObjectSchema.safeParse(request.input);
  if (!given.success) {
    return { content: "A tool's input is a JSON object.", isError: true };
  }
  const input = row.writes
    ? { ...given.data, [OP_ID]: await agentOpId(request.threadId, request.toolUseId) }
    : given.data;
  try {
    const output: unknown = await call(procedure, input, {
      context,
      interceptors: [fitAgentResult],
      path: [...row.path],
    });
    return { content: JSON.stringify(output ?? null), isError: false };
  } catch (error) {
    return {
      content: isOrpcError(error) ? errorText(error) : "That could not be done right now.",
      isError: true,
    };
  }
};
