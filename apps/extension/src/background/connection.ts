import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";
import { browser } from "wxt/browser";
import { z } from "zod";

import { DEV_CLOUD_ORIGIN } from "../manifest";

const CONNECTION_KEY = "connection";

const connectionSchema = z.strictObject({ cookie: z.hash("sha256"), email: z.string().min(1) });

export type Connection = z.infer<typeof connectionSchema>;

export const readConnection = async () => {
  const stored = await browser.storage.local.get(CONNECTION_KEY);
  const parsed = connectionSchema.safeParse(stored[CONNECTION_KEY]);

  return parsed.success ? parsed.data : null;
};

export const keepConnection = async (connection: Connection) => {
  await browser.storage.local.set({ [CONNECTION_KEY]: connection });
};

export const forgetConnection = async () => {
  await browser.storage.local.remove(CONNECTION_KEY);
};

const DEV_CLOUD_KEY = "cloud-origin";

const devCloudOrigin = async () => {
  const stored = await browser.storage.local.get(DEV_CLOUD_KEY);

  const named = z
    .string()
    .regex(/^http:\/\/localhost:\d+$/u)
    .safeParse(stored[DEV_CLOUD_KEY]);

  return named.success ? named.data : DEV_CLOUD_ORIGIN;
};

export const cloudOrigin = async () =>
  import.meta.env.MODE === "store" ? PRODUCTION_CLOUD_ORIGIN : await devCloudOrigin();
