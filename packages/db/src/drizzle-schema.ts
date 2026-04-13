/**
 * Application schema
 */
import { relations } from "drizzle-orm";
import { pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "./drizzle-schema-auth";

export const waitlist = pgTable("waitlist", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text("user_id").references(() => user.id),
  source: t.text(),
  email: t.text().notNull(),
}));

export const waitlistRelations = relations(waitlist, ({ one }) => ({
  user: one(user, {
    fields: [waitlist.userId],
    references: [user.id],
  }),
}));

// ---------------------------------------------------------------------------
// Dispatch — relay between mobile and desktop apps
// ---------------------------------------------------------------------------

export const dispatchMessageDirectionEnum = pgEnum("dispatch_message_direction", [
  "to_device",
  "to_mobile",
]);

export const dispatchMessageStatusEnum = pgEnum("dispatch_message_status", [
  "pending",
  "delivered",
]);

/** A registered desktop device that can receive dispatch messages */
export const dispatchDevice = pgTable("dispatch_device", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** The user who paired this device (null until paired) */
  userId: t.text("user_id").references(() => user.id, { onDelete: "cascade" }),
  /** Human-readable device name, e.g. "MacBook Pro" */
  name: t.text().notNull(),
  /** Opaque token the device uses to authenticate dispatch API calls */
  token: t.text().notNull().unique(),
  /** Short code displayed on desktop for mobile to pair with */
  pairingCode: t.text("pairing_code"),
  /** When the pairing code expires */
  pairingExpiresAt: t.timestamp("pairing_expires_at"),
  /** Whether the device is currently online (heartbeat-based) */
  isOnline: t.boolean("is_online").notNull().default(false),
  /** Last time the device sent a heartbeat */
  lastHeartbeatAt: t.timestamp("last_heartbeat_at"),
  createdAt: t
    .timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
}));

/** Messages relayed between mobile and desktop */
export const dispatchMessage = pgTable("dispatch_message", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** Target device */
  deviceId: t
    .uuid("device_id")
    .notNull()
    .references(() => dispatchDevice.id, { onDelete: "cascade" }),
  /** Which way the message is flowing */
  direction: dispatchMessageDirectionEnum().notNull(),
  /** Message type: user_message, steer, interrupt, agent_event, etc. */
  type: t.text().notNull(),
  /** Arbitrary JSON payload */
  payload: t.jsonb().notNull().default({}),
  /** Pending until the recipient polls it */
  status: dispatchMessageStatusEnum().notNull().default("pending"),
  createdAt: t
    .timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
}));

// -- Relations ----------------------------------------------------------------

export const dispatchDeviceRelations = relations(dispatchDevice, ({ one, many }) => ({
  user: one(user, {
    fields: [dispatchDevice.userId],
    references: [user.id],
  }),
  messages: many(dispatchMessage),
}));

export const dispatchMessageRelations = relations(dispatchMessage, ({ one }) => ({
  device: one(dispatchDevice, {
    fields: [dispatchMessage.deviceId],
    references: [dispatchDevice.id],
  }),
}));
