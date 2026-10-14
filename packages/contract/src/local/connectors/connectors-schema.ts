// a connector is a row of the default agent's own MCP config, read and written through the
// vendor's bundled binary: the list is what the vendor holds, so it names the agent it belongs to.

import { harnessIdSchema } from "@repo/domain/harness";
import { z } from "zod";

// what this app adds is a name no vendor flag can start with; a row the vendor already holds may
// carry any name, and is only ever passed after `--`.
export const CONNECTOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
export const CONNECTOR_NAME_MAX_LENGTH = 64;
export const CONNECTOR_ARGS_MAX = 64;

export const connectorNameSchema = z
  .string()
  .min(1)
  .max(CONNECTOR_NAME_MAX_LENGTH)
  .regex(
    CONNECTOR_NAME_PATTERN,
    "must start with a letter or number and use letters, numbers, '-' and '_' only",
  );

const VENDOR_ROW_NAME_MAX_LENGTH = 256;
const vendorRowNameSchema = z.string().min(1).max(VENDOR_ROW_NAME_MAX_LENGTH);

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

export const connectorUrlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return HTTP_PROTOCOLS.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "must be an http:// or https:// URL");

export const connectorTargetInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("http"), url: connectorUrlSchema }),
  z.strictObject({
    args: z.array(z.string().min(1)).max(CONNECTOR_ARGS_MAX),
    command: z.string().min(1),
    kind: z.literal("stdio"),
  }),
]);
export type ConnectorTargetInput = z.infer<typeof connectorTargetInputSchema>;

// other: a transport the vendor holds and this app neither adds nor signs in to, named as the
// vendor names it.
export const connectorTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("http"), url: z.string().min(1) }),
  z.strictObject({
    args: z.array(z.string()),
    command: z.string().min(1),
    kind: z.literal("stdio"),
  }),
  z.strictObject({ kind: z.literal("other"), type: z.string().min(1) }),
]);
export type ConnectorTarget = z.infer<typeof connectorTargetSchema>;

// the vendor's own answer: unknown is a vendor that keeps none it will say without connecting.
export const connectorAuthSchema = z.enum(["signed-in", "needs-sign-in", "not-needed", "unknown"]);
export type ConnectorAuth = z.infer<typeof connectorAuthSchema>;

// a sign-in this server ran for the row. url: the address the vendor printed for a browser that
// did not open, null until it prints one.
export const connectorSignInSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }),
  z.strictObject({ state: z.literal("pending"), url: z.string().nullable() }),
  z.strictObject({ detail: z.string(), state: z.literal("failed") }),
]);
export type ConnectorSignIn = z.infer<typeof connectorSignInSchema>;

export const connectorViewSchema = z.strictObject({
  auth: connectorAuthSchema,
  name: z.string().min(1),
  signIn: connectorSignInSchema,
  target: connectorTargetSchema,
});
export type ConnectorView = z.infer<typeof connectorViewSchema>;

export const connectorTargetText = (target: ConnectorTarget): string => {
  switch (target.kind) {
    case "stdio": {
      return [target.command, ...target.args].join(" ");
    }
    case "http": {
      return target.url;
    }
    case "other": {
      return target.type;
    }
    // no default
  }
};

// the harness a new thread starts on, whose config every row is.
export const connectorsResponseSchema = z.strictObject({
  agent: z.strictObject({ displayName: z.string().min(1), id: harnessIdSchema }),
  servers: z.array(connectorViewSchema),
});
export type ConnectorsResponse = z.infer<typeof connectorsResponseSchema>;

export const connectorAddRequestSchema = z.strictObject({
  name: connectorNameSchema,
  target: connectorTargetInputSchema,
});
export type ConnectorAddRequest = z.infer<typeof connectorAddRequestSchema>;

export const connectorRowRequestSchema = z.strictObject({ name: vendorRowNameSchema });
export type ConnectorRowRequest = z.infer<typeof connectorRowRequestSchema>;
