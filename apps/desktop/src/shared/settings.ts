import { z } from "zod";

// ---------------------------------------------------------------------------
// Settings schemas — persisted to ~/.inteligir/settings.json
// ---------------------------------------------------------------------------

export const OAuthCredentialsSchema = z.object({
  access: z.string(),
  refresh: z.string(),
  expires: z.number(),
});

export type OAuthCredentials = z.infer<typeof OAuthCredentialsSchema>;

export const SettingsSchema = z.object({
  oauthCredentials: OAuthCredentialsSchema.optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

// ---------------------------------------------------------------------------
// Method params & results
// ---------------------------------------------------------------------------

export type GetSettingsResult = { loggedIn: boolean };

export type LoginResult = { ok: true } | { ok: false; error: string };
export type LogoutResult = { ok: true };
