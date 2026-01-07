/**
 * Application schema
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./drizzle-schema-auth";

export const textStyleEnum = pgEnum("text_style", [
  "DEFAULT",
  "SERIF",
  "MONO",
]);

export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  userId: text("user_id").references(() => user.id),
  source: text("source"),
  email: text("email"),
});

export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    parentDocumentId: text("parent_document_id"),
    title: text("title"),
    content: text("content"),
    contentRich: jsonb("content_rich"),
    coverImage: text("cover_image"),
    icon: text("icon"),
    isPublished: boolean("is_published").default(false).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    textStyle: textStyleEnum("text_style").default("DEFAULT").notNull(),
    smallText: boolean("small_text").default(false).notNull(),
    fullWidth: boolean("full_width").default(false).notNull(),
    lockPage: boolean("lock_page").default(false).notNull(),
    toc: boolean("toc").default(true).notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgTemplateUnique: uniqueIndex("document_org_template_unique").on(
      table.organizationId,
      table.templateId,
    ),
    parentFk: foreignKey({
      columns: [table.parentDocumentId],
      foreignColumns: [table.id],
      name: "document_parent_document_id_document_id_fk",
    }).onDelete("set null"),
  }),
);

export const documentVersion = pgTable("document_version", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => document.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title"),
  contentRich: jsonb("content_rich"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export const discussion = pgTable("discussion", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => document.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  documentContent: text("document_content").notNull(),
  documentContentRich: jsonb("document_content_rich"),
  isResolved: boolean("is_resolved").default(false).notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export const comment = pgTable("comment", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  discussionId: text("discussion_id")
    .notNull()
    .references(() => discussion.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  contentRich: jsonb("content_rich"),
  isEdited: boolean("is_edited").default(false).notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export const file = pgTable("file", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  documentId: text("document_id").references(() => document.id, {
    onDelete: "set null",
  }),
  size: integer("size").notNull(),
  url: text("url").notNull(),
  appUrl: text("app_url").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export const waitlistRelations = relations(waitlist, ({ one }) => ({
  user: one(user, {
    fields: [waitlist.userId],
    references: [user.id],
  }),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
  user: one(user, {
    fields: [document.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [document.organizationId],
    references: [organization.id],
  }),
  parent: one(document, {
    fields: [document.parentDocumentId],
    references: [document.id],
  }),
  children: many(document),
  discussions: many(discussion),
  files: many(file),
  versions: many(documentVersion),
}));

export const documentVersionRelations = relations(
  documentVersion,
  ({ one }) => ({
    document: one(document, {
      fields: [documentVersion.documentId],
      references: [document.id],
    }),
    user: one(user, {
      fields: [documentVersion.userId],
      references: [user.id],
    }),
  }),
);

export const discussionRelations = relations(discussion, ({ one, many }) => ({
  document: one(document, {
    fields: [discussion.documentId],
    references: [document.id],
  }),
  user: one(user, {
    fields: [discussion.userId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  discussion: one(discussion, {
    fields: [comment.discussionId],
    references: [discussion.id],
  }),
}));

export const fileRelations = relations(file, ({ one }) => ({
  user: one(user, {
    fields: [file.userId],
    references: [user.id],
  }),
  document: one(document, {
    fields: [file.documentId],
    references: [document.id],
  }),
}));
