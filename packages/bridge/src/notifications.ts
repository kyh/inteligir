// ---------------------------------------------------------------------------
// The notification preference, as it crosses the wire. It is persisted in the
// host's own store and NOTHING reads it back yet — see CLAUDE.md § "Settings →
// Notifications is STORED AND UNWIRED". Build the capability or delete this
// module with its two channels; a switch that promises what no surface
// delivers is not a third option.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

export type NotificationSettings = {
  enabled: boolean;
};

export const NotificationsPatchSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
