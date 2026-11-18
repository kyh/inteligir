// The built-in agent's library tools: every row tagged a tool under a name of the contract's table
// (`../library/library-tools`) that the library routes now, so a row routed later joins without a
// list kept here. eve builds each tool's definition from its input, the op id left out, which the
// call derives itself. A call runs through the library's router as the turn (`runAgentTool`), as a
// client call lands, its op id read off eve's session and call ids, so a call run again when its
// step retries answers what it first did. An answer is its JSON, at most 40,000 characters: a paged
// list is asked again at half its rows until it fits, and what still does not is refused, a read
// told to ask for less and a write that it landed. A refusal is an outcome the agent reads, never a
// failed turn.

import { createHash } from "node:crypto";

import { isLibraryToolName } from "@repo/contract/library/agent-tools";
import type { LibraryToolName } from "@repo/contract/library/agent-tools";
import { PAGE_MAX } from "@repo/contract/library/library-wire";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { getMcpToolMeta } from "@orpc/mcp";
import { call, getRouter, ORPCError, Procedure } from "@orpc/server";
import type {
  AnyProcedure,
  AnySchema,
  Context,
  ErrorMap,
  ProcedureClientInterceptor,
} from "@orpc/server";
import { z } from "zod";

import type { LibraryContext } from "../library/library-access";
import { TAGGED_ROWS } from "../library/library-tools";
import { libraryRouter } from "../rpc/library-router";
import type { agentCallOutcomeSchema } from "./thread-events";

const AGENT_RESULT_MAX_CHARS = 40_000;

// the property a write's input carries its op id in, which the agent never writes
const OP_ID = "opId";

const jsonSchemaSchema = z.record(z.string(), z.json());
type JsonSchema = z.infer<typeof jsonSchemaSchema>;

export interface AgentTool {
  readonly name: LibraryToolName;
  readonly description: string;
  // the row's input as the model writes it, as JSON Schema: the router checks it whole on the call
  readonly input: JsonSchema;
  readonly path: readonly string[];
  readonly procedure: AnyProcedure;
  readonly writes: boolean;
}

export type AgentCallOutcome = z.infer<typeof agentCallOutcomeSchema>;

const procedureAt = (path: readonly string[]): AnyProcedure | null => {
  const found = getRouter(libraryRouter, path);
  return found instanceof Procedure ? found : null;
};

const requiredSchema = z.array(z.string()).optional();

// the row's input as JSON Schema, its op id left out
const modelInputOf = (schema: z.ZodObject, writes: boolean): JsonSchema => {
  const { $schema: _dialect, ...json } = jsonSchemaSchema.parse(
    z.toJSONSchema(schema, { io: "input" }),
  );
  if (!writes) {
    return json;
  }
  const { required: written, ...rest } = json;
  const { [OP_ID]: _opId, ...properties } = jsonSchemaSchema.parse(json.properties ?? {});
  const required = (requiredSchema.parse(written) ?? []).filter((key) => key !== OP_ID);
  return required.length === 0 ? { ...rest, properties } : { ...rest, properties, required };
};

const toolOf = (path: readonly string[], name: string, description: string): AgentTool[] => {
  const procedure = procedureAt(path);
  if (!isLibraryToolName(name) || procedure === null) {
    return [];
  }
  // a row that takes no input takes an empty object
  const [schema = z.strictObject({})] = procedure["~orpc"].inputSchemas ?? [];
  if (!(schema instanceof z.ZodObject)) {
    throw new TypeError(`the library tool ${name} takes an object`);
  }
  const writes = Object.hasOwn(schema.shape, OP_ID);
  return [
    {
      description,
      input: modelInputOf(schema, writes),
      name,
      path,
      procedure,
      writes,
    },
  ];
};

// sorted by name: their definitions are every conversation's cached prefix
export const AGENT_TOOLS: readonly AgentTool[] = TAGGED_ROWS.flatMap(({ path, tool }) =>
  tool.name === undefined ? [] : toolOf(path, tool.name, tool.description ?? ""),
).toSorted((left, right) => left.name.localeCompare(right.name));

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
  const reads = getMcpToolMeta(options.procedure)?.annotations?.readOnlyHint === true;
  throw new ORPCError("PAYLOAD_TOO_LARGE", {
    message: reads ? TOO_LONG_TO_READ : TOO_LONG_TO_SHOW,
  });
};

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

// the op id a call's write keeps: a UUID read off the hash of its eve session and call, so the
// same call lands once however often its step runs
export const agentOpId = (eveSessionId: string, callId: string): string => {
  const hex = createHash("sha256").update(`${eveSessionId}:${callId}`).digest("hex");
  // version 8 (RFC 9562 § 5.8) and the RFC's variant over the hash's own bits
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) % 4) + 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const jsonObjectSchema = z.record(z.string(), z.unknown());

// one call run through the router as the context's turn, its outcome as the agent reads it
export const callAgentTool = async (
  context: LibraryContext,
  tool: AgentTool,
  request: { readonly input: unknown; readonly eveSessionId: string; readonly callId: string },
): Promise<AgentCallOutcome> => {
  const given = jsonObjectSchema.safeParse(request.input);
  if (!given.success) {
    return { kind: "failed", text: "A tool's input is a JSON object." };
  }
  const input = tool.writes
    ? { ...given.data, [OP_ID]: agentOpId(request.eveSessionId, request.callId) }
    : given.data;
  try {
    const output: unknown = await call(tool.procedure, input, {
      context,
      interceptors: [fitAgentResult],
      path: [...tool.path],
    });
    return { kind: "ran", text: JSON.stringify(output ?? null) };
  } catch (error) {
    if (isOrpcError(error)) {
      return { kind: "failed", text: errorText(error) };
    }
    console.error({ error, event: "agent-tool-failed", tool: tool.name });
    return { kind: "failed", text: "That could not be done right now." };
  }
};
