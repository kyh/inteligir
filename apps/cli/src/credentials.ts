import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const tokensSchema = z.looseObject({
  access_token: z.string(),
  expires_in: z.number().optional(),
  issuer: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string(),
});

const clientSchema = z.looseObject({
  client_id: z.string(),
  issuer: z.string().optional(),
});

const heldSchema = z.object({
  client: clientSchema.optional(),
  site: z.url(),
  tokens: tokensSchema.optional(),
});

export type Held = z.infer<typeof heldSchema>;

export const credentialsPath = (env: NodeJS.ProcessEnv) =>
  path.join(
    env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "inteligir",
    "credentials.json",
  );

export const readHeld = async (file: string) => {
  let text = "";

  try {
    text = await readFile(file, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  try {
    const parsed = heldSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const writeHeld = async (file: string, held: Held) => {
  await mkdir(path.dirname(file), { mode: 0o700, recursive: true });
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
};

export const forgetHeld = async (file: string) => {
  await rm(file, { force: true });
};
