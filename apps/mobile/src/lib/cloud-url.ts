import Constants from "expo-constants";
import { z } from "zod";

const extraSchema = z.object({ cloudUrl: z.string().min(1) });

// no LAN-host fallback: the Worker's dev server binds localhost, so a guessed Metro-host origin
// never answers a phone.
export function getCloudUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CLOUD_URL;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  const extra = extraSchema.safeParse(Constants.expoConfig?.extra);
  if (extra.success) return extra.data.cloudUrl;

  throw new Error("cloud URL unset — set EXPO_PUBLIC_CLOUD_URL or app.config extra.cloudUrl");
}
