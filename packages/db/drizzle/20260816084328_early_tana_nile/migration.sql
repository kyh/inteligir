CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`item_id` text,
	`item_kind` text,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "events_scope_shape_check" CHECK((
        ("events"."scope_kind" = 'turn' AND "events"."turn_id" IS NOT NULL)
        OR
        ("events"."scope_kind" = 'thread' AND "events"."turn_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_thread_sequence_idx` ON `events` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `events_thread_type_sequence_idx` ON `events` (`thread_id`,`type`,`sequence`);--> statement-breakpoint
CREATE INDEX `events_thread_turn_type_item_sequence_idx` ON `events` (`thread_id`,`turn_id`,`type`,`item_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `pending_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text,
	`request_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`resolution` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_interactions_thread_request_idx` ON `pending_interactions` (`thread_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_status_created_idx` ON `pending_interactions` (`thread_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `queued_thread_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`text` text NOT NULL,
	`claimed_at` integer,
	`claim_token` text,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_sort_idx` ON `queued_thread_messages` (`thread_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_turn_id` text,
	`origin_doc_path` text,
	`origin_anchor` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "threads_origin_pair_check" CHECK(("threads"."origin_doc_path" IS NULL) = ("threads"."origin_anchor" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `threads_live_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `threads_archived_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NOT NULL;--> statement-breakpoint
UPDATE `meta` SET `value` = '2' WHERE `key` = 'schema_version';