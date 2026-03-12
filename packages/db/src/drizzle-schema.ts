/**
 * Application schema
 */
import { relations } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { user } from "./drizzle-schema-auth";

export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  userId: text("user_id").references(() => user.id),
  source: text("source"),
  email: text("email"),
});

export const waitlistRelations = relations(waitlist, ({ one }) => ({
  user: one(user, {
    fields: [waitlist.userId],
    references: [user.id],
  }),
}));
