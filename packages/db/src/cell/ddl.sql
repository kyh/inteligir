-- Written by packages/db/scripts/object-ddl.ts from src/cell/schema.ts: edit the schema,
-- then run `pnpm --filter @repo/db ddl`.

CREATE TABLE `agent_pushes` (
	`thread_id` text PRIMARY KEY,
	`seq` integer NOT NULL
);

CREATE TABLE `agent_queue` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`message` text NOT NULL,
	`queued_at` integer NOT NULL
);

CREATE TABLE `agent_switch` (
	`slot` integer PRIMARY KEY,
	`enabled` integer NOT NULL,
	CONSTRAINT "agent_switch_slot" CHECK("slot" = 1),
	CONSTRAINT "agent_switch_enabled" CHECK("enabled" IN (0, 1))
);

CREATE TABLE `agent_turns` (
	`thread_id` text PRIMARY KEY,
	`turn` integer NOT NULL,
	`message` text NOT NULL,
	`waiting` integer DEFAULT 0 NOT NULL,
	`cancel` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`heard_at` integer NOT NULL,
	CONSTRAINT "agent_turns_waiting" CHECK("waiting" >= 0),
	CONSTRAINT "agent_turns_cancel" CHECK("cancel" IN (0, 1))
);

CREATE TABLE `agent_usage` (
	`day` text PRIMARY KEY,
	`turns` integer NOT NULL
);

CREATE TABLE `applied_ops` (
	`op_id` text PRIMARY KEY,
	`answer` text NOT NULL,
	`at` integer NOT NULL
);

CREATE TABLE `blob_uploads` (
	`sha256` text PRIMARY KEY,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL
);

CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`refs` integer NOT NULL
);

CREATE TABLE `body_texts` (
	`item_id` text NOT NULL,
	`part` integer NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT `body_texts_pk` PRIMARY KEY(`item_id`, `part`)
);

CREATE TABLE `change_set_blobs` (
	`item_id` text NOT NULL,
	`change_set_id` text NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `change_set_blobs_pk` PRIMARY KEY(`item_id`, `change_set_id`, `sha256`)
);

CREATE TABLE `change_set_items` (
	`change_set_id` text NOT NULL,
	`item_id` text NOT NULL,
	`made` text,
	`inverse` text,
	CONSTRAINT `change_set_items_pk` PRIMARY KEY(`change_set_id`, `item_id`),
	CONSTRAINT "change_set_items_entry" CHECK(("made" IS NULL) <> ("inverse" IS NULL))
);

CREATE TABLE `change_sets` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`turn` integer NOT NULL,
	`opened_at` integer NOT NULL,
	`sealed_at` integer,
	`undone_at` integer,
	CONSTRAINT "change_sets_undone" CHECK("undone_at" IS NULL OR "sealed_at" IS NOT NULL)
);

CREATE TABLE `folders` (
	`id` text PRIMARY KEY,
	`parent_id` text,
	`name` text NOT NULL,
	`sort` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL
);

CREATE TABLE `item_blobs` (
	`item_id` text NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `item_blobs_pk` PRIMARY KEY(`item_id`, `sha256`)
);

CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	`origin` text NOT NULL,
	CONSTRAINT `item_tags_pk` PRIMARY KEY(`item_id`, `tag`, `origin`),
	CONSTRAINT "item_tags_origin" CHECK("origin" IN ('field', 'inline'))
);

CREATE TABLE `items` (
	`rid` integer PRIMARY KEY,
	`id` text NOT NULL,
	`kind` text,
	`title` text,
	`folder_id` text,
	`aliases` text,
	`tags` text,
	`properties` text,
	`url` text,
	`url_key` text,
	`site` text,
	`author` text,
	`published` text,
	`description` text,
	`lang` text,
	`cover_sha` text,
	`original_sha` text,
	`original_name` text,
	`fetch_state` text,
	`fetched_at` integer,
	`fetch_error` text,
	`saved_at` integer,
	`updated_at` integer NOT NULL,
	`pinned_at` integer,
	`deleted_at` integer,
	`purged` integer DEFAULT 0 NOT NULL,
	`card` text,
	`body_home` text,
	`body_digest` text,
	`body_version` integer,
	`body_bytes` integer,
	`seq` integer NOT NULL,
	CONSTRAINT "items_kind" CHECK("kind" IN ('note', 'link', 'video', 'audio', 'image', 'pdf', 'file')),
	CONSTRAINT "items_fetch_state" CHECK("fetch_state" IN ('none', 'pending', 'filled', 'failed')),
	CONSTRAINT "items_purged" CHECK("purged" IN (0, 1)),
	CONSTRAINT "items_body_home" CHECK("body_home" IN ('seed', 'opening', 'note')),
	CONSTRAINT "items_whole" CHECK("purged" = 1 OR ("kind" IS NOT NULL AND "title" IS NOT NULL
        AND "aliases" IS NOT NULL AND "tags" IS NOT NULL AND "properties" IS NOT NULL
        AND "fetch_state" IS NOT NULL AND "saved_at" IS NOT NULL AND "card" IS NOT NULL
        AND "body_home" IS NOT NULL AND "body_digest" IS NOT NULL
        AND "body_version" IS NOT NULL AND "body_bytes" IS NOT NULL))
);

CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_at` integer
);

CREATE TABLE `links` (
	`source_id` text NOT NULL,
	`target_id` text,
	`target_key` text
);

CREATE TABLE `meta` (
	`k` text PRIMARY KEY,
	`v` 
);

CREATE TABLE `note_sockets` (
	`session_id` text NOT NULL,
	`item_id` text NOT NULL,
	CONSTRAINT `note_sockets_pk` PRIMARY KEY(`session_id`, `item_id`)
);

CREATE TABLE `seed_blocks` (
	`item_id` text NOT NULL,
	`pos` integer NOT NULL,
	`block_id` text NOT NULL,
	`section` text NOT NULL,
	`json` text NOT NULL,
	CONSTRAINT `seed_blocks_pk` PRIMARY KEY(`item_id`, `pos`),
	CONSTRAINT "seed_blocks_section" CHECK("section" IN ('note', 'article'))
);

CREATE TABLE `thread_events` (
	`event_id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`idx` integer NOT NULL,
	`type` text NOT NULL,
	`json` text NOT NULL,
	`at` integer NOT NULL
);

CREATE TABLE `threads` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE INDEX `agent_queue_order` ON `agent_queue` (`queued_at`,`id`);
CREATE INDEX `applied_ops_at` ON `applied_ops` (`at`);
CREATE INDEX `change_set_blobs_sha` ON `change_set_blobs` (`sha256`);
CREATE INDEX `change_set_items_item` ON `change_set_items` (`item_id`);
CREATE UNIQUE INDEX `change_sets_turn` ON `change_sets` (`thread_id`,`turn`);
CREATE INDEX `item_tags_tag` ON `item_tags` (`tag`);
CREATE UNIQUE INDEX `items_id` ON `items` (`id`);
CREATE UNIQUE INDEX `one_url` ON `items` (`url_key`) WHERE "items"."deleted_at" IS NULL AND "items"."url_key" IS NOT NULL;
CREATE INDEX `items_seq` ON `items` (`seq`);
CREATE INDEX `jobs_next` ON `jobs` (`next_at`);
CREATE INDEX `links_source` ON `links` (`source_id`);
CREATE INDEX `links_target` ON `links` (`target_id`);
CREATE INDEX `links_key` ON `links` (`target_key`);
CREATE INDEX `thread_events_thread` ON `thread_events` (`thread_id`,`idx`);

CREATE VIRTUAL TABLE `search_fts` USING fts5(
  title, headings, meta, body,
  title_stems, heading_stems, meta_stems, body_stems,
  content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
);
