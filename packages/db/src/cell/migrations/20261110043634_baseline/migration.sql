CREATE TABLE `agent_calls` (
	`call_id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`turn` integer NOT NULL,
	`day` text NOT NULL,
	`reserved_ucents` integer NOT NULL,
	`max_tokens` integer NOT NULL,
	`cost_ucents` integer,
	`cut` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_calls_cut" CHECK("cut" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `agent_pushes` (
	`thread_id` text PRIMARY KEY,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_queue` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`message` text NOT NULL,
	`queued_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_switch` (
	`slot` integer PRIMARY KEY,
	`enabled` integer NOT NULL,
	CONSTRAINT "agent_switch_slot" CHECK("slot" = 1),
	CONSTRAINT "agent_switch_enabled" CHECK("enabled" IN (0, 1))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `agent_usage` (
	`day` text PRIMARY KEY,
	`turns` integer NOT NULL,
	`cost_ucents` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applied_ops` (
	`op_id` text PRIMARY KEY,
	`answer` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blob_uploads` (
	`sha256` text PRIMARY KEY,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`refs` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `body_texts` (
	`item_id` text NOT NULL,
	`part` integer NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT `body_texts_pk` PRIMARY KEY(`item_id`, `part`)
);
--> statement-breakpoint
CREATE TABLE `change_set_blobs` (
	`item_id` text NOT NULL,
	`hash` text NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `change_set_blobs_pk` PRIMARY KEY(`item_id`, `hash`, `sha256`)
);
--> statement-breakpoint
CREATE TABLE `change_set_items` (
	`change_set_id` text NOT NULL,
	`item_id` text NOT NULL,
	`created` integer NOT NULL,
	`before_fields` text,
	`after_fields` text,
	CONSTRAINT `change_set_items_pk` PRIMARY KEY(`change_set_id`, `item_id`),
	CONSTRAINT "change_set_items_created" CHECK("created" IN (0, 1)),
	CONSTRAINT "change_set_items_made" CHECK(("created" = 1) = ("before_fields" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `change_sets` (
	`id` text PRIMARY KEY,
	`actor` text NOT NULL,
	`actor_id` text,
	`label` text NOT NULL,
	`session_id` text,
	`thread_id` text,
	`turn` integer,
	`client_id` text,
	`opened_at` integer NOT NULL,
	`touched_at` integer NOT NULL,
	`sealed_at` integer,
	`undone_by` text,
	CONSTRAINT "change_sets_actor" CHECK("actor" IN ('person', 'agent', 'assistant', 'import', 'fill', 'undo'))
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY,
	`parent_id` text,
	`name` text NOT NULL,
	`sort` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`sha` text NOT NULL,
	`state` text NOT NULL,
	`phase` text NOT NULL,
	`cursor` integer NOT NULL,
	`total` integer NOT NULL,
	`added` integer NOT NULL,
	`already_saved` integer NOT NULL,
	`skipped` integer NOT NULL,
	`unreadable` integer NOT NULL,
	`change_set_id` text,
	`message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT "import_jobs_source" CHECK("source" IN ('raindrop', 'markdown')),
	CONSTRAINT "import_jobs_state" CHECK("state" IN ('running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "import_jobs_phase" CHECK("phase" IN ('reading', 'landing', 'files'))
);
--> statement-breakpoint
CREATE TABLE `import_rows` (
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`idx` integer NOT NULL,
	`json` text NOT NULL,
	CONSTRAINT `import_rows_pk` PRIMARY KEY(`job_id`, `kind`, `idx`)
);
--> statement-breakpoint
CREATE TABLE `item_blobs` (
	`item_id` text NOT NULL,
	`sha256` text NOT NULL,
	CONSTRAINT `item_blobs_pk` PRIMARY KEY(`item_id`, `sha256`)
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	`origin` text NOT NULL,
	CONSTRAINT `item_tags_pk` PRIMARY KEY(`item_id`, `tag`, `origin`),
	CONSTRAINT "item_tags_origin" CHECK("origin" IN ('field', 'inline'))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_at` integer
);
--> statement-breakpoint
CREATE TABLE `links` (
	`source_id` text NOT NULL,
	`target_id` text,
	`target_key` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`k` text PRIMARY KEY,
	`v` 
);
--> statement-breakpoint
CREATE TABLE `note_sockets` (
	`session_id` text NOT NULL,
	`item_id` text NOT NULL,
	CONSTRAINT `note_sockets_pk` PRIMARY KEY(`session_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `seed_blocks` (
	`item_id` text NOT NULL,
	`pos` integer NOT NULL,
	`block_id` text NOT NULL,
	`section` text NOT NULL,
	`json` text NOT NULL,
	CONSTRAINT `seed_blocks_pk` PRIMARY KEY(`item_id`, `pos`),
	CONSTRAINT "seed_blocks_section" CHECK("section" IN ('note', 'article'))
);
--> statement-breakpoint
CREATE TABLE `snapshot_parts` (
	`item_id` text NOT NULL,
	`hash` text NOT NULL,
	`json` text NOT NULL,
	CONSTRAINT `snapshot_parts_pk` PRIMARY KEY(`item_id`, `hash`)
);
--> statement-breakpoint
CREATE TABLE `thread_events` (
	`event_id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`idx` integer NOT NULL,
	`type` text NOT NULL,
	`json` text NOT NULL,
	`at` integer NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_calls_turn` ON `agent_calls` (`thread_id`,`turn`);--> statement-breakpoint
CREATE INDEX `agent_calls_open` ON `agent_calls` (`cost_ucents`);--> statement-breakpoint
CREATE INDEX `agent_queue_order` ON `agent_queue` (`queued_at`,`id`);--> statement-breakpoint
CREATE INDEX `applied_ops_at` ON `applied_ops` (`at`);--> statement-breakpoint
CREATE INDEX `change_set_blobs_sha` ON `change_set_blobs` (`sha256`);--> statement-breakpoint
CREATE INDEX `change_set_items_item` ON `change_set_items` (`item_id`);--> statement-breakpoint
CREATE INDEX `change_sets_open` ON `change_sets` (`actor`,`sealed_at`);--> statement-breakpoint
CREATE INDEX `item_tags_tag` ON `item_tags` (`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_id` ON `items` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_url` ON `items` (`url_key`) WHERE "items"."deleted_at" IS NULL AND "items"."url_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `items_seq` ON `items` (`seq`);--> statement-breakpoint
CREATE INDEX `jobs_next` ON `jobs` (`next_at`);--> statement-breakpoint
CREATE INDEX `links_source` ON `links` (`source_id`);--> statement-breakpoint
CREATE INDEX `links_target` ON `links` (`target_id`);--> statement-breakpoint
CREATE INDEX `links_key` ON `links` (`target_key`);--> statement-breakpoint
CREATE INDEX `thread_events_thread` ON `thread_events` (`thread_id`,`idx`);