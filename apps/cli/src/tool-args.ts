import type { Tool } from "@modelcontextprotocol/client";
import { z } from "zod";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const toolInputsSchema = z.looseObject({
  properties: z
    .record(
      z.string(),
      z.looseObject({
        anyOf: z.array(z.looseObject({ type: z.string().optional() })).optional(),
        type: z.union([z.string(), z.array(z.string())]).optional(),
      }),
    )
    .optional(),
  required: z.array(z.string()).optional(),
});

export type InputProperty = NonNullable<z.infer<typeof toolInputsSchema>["properties"]>[string];

const argumentsSchema = z.record(z.string(), z.json());

type ToolArguments = z.infer<typeof argumentsSchema>;

export const toolInputs = (inputSchema: Tool["inputSchema"]) => {
  const parsed = toolInputsSchema.safeParse(inputSchema);

  return parsed.success ? parsed.data : { properties: {}, required: [] };
};

const takesText = (type: string | readonly string[] | undefined) =>
  type === "string" || (Array.isArray(type) && type.length === 1 && type[0] === "string");

const valueOf = (raw: string, type: string | readonly string[] | undefined) => {
  if (takesText(type)) {
    return raw;
  }

  try {
    return z.json().parse(JSON.parse(raw));
  } catch {
    return raw;
  }
};

export const toolArguments = (words: readonly string[], inputSchema: Tool["inputSchema"]) => {
  const [first] = words;

  if (words.length === 1 && first?.trimStart().startsWith("{") === true) {
    try {
      return argumentsSchema.parse(JSON.parse(first));
    } catch {
      throw new UsageError("That isn't a JSON object of arguments.");
    }
  }

  const { properties = {} } = toolInputs(inputSchema);
  const args: ToolArguments = {};

  for (const word of words) {
    const at = word.indexOf("=");

    if (at <= 0) {
      throw new UsageError(`"${word}" isn't name=value.`);
    }

    const name = word.slice(0, at);
    args[name] = valueOf(word.slice(at + 1), properties[name]?.type);
  }

  return args;
};
