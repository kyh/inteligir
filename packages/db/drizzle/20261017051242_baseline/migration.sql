CREATE TABLE `events` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`item_id` text,
	`item_kind` text,
	`data` text DEFAULT '{}' NOT NULL,
	`origin_device_id` text,
	`origin_device_seq` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_events_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT "events_scope_shape_check" CHECK((
        ("scope_kind" = 'turn' AND "turn_id" IS NOT NULL)
        OR
        ("scope_kind" = 'thread' AND "turn_id" IS NULL)
      )),
	CONSTRAINT "events_origin_shape_check" CHECK(("origin_device_id" IS NULL) = ("origin_device_seq" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_fills` (
	`item_id` text PRIMARY KEY,
	`path` text NOT NULL,
	`url` text NOT NULL,
	`origin` text NOT NULL,
	`keep_copy` integer DEFAULT false NOT NULL,
	`cover_hint` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`not_before` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_interactions` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`turn_id` text,
	`request_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`decision` text,
	`relay` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pending_interactions_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT "pending_interactions_decision_shape_check" CHECK(("status" = 'resolved') = ("decision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `queued_thread_messages` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`sort_key` text NOT NULL,
	`text` text NOT NULL,
	`context_paths` text,
	`preset` text,
	`dispatch_id` text,
	`claimed_at` integer,
	`claim_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_queued_thread_messages_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT "queued_thread_messages_claim_shape_check" CHECK(("claimed_at" IS NULL) = ("claim_token" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY,
	`device_seq` integer NOT NULL,
	`thread_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_own_devices` (
	`device_id` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY,
	`last_device_seq` integer DEFAULT 0 NOT NULL,
	`dropped_events` integer DEFAULT 0 NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`skipped_from_seq` integer,
	`skipped_by_build` text,
	`last_synced_at` integer,
	CONSTRAINT "sync_state_singleton_check" CHECK("id" = 1),
	CONSTRAINT "sync_state_skip_marker_shape_check" CHECK(("skipped_from_seq" IS NULL) = ("skipped_by_build" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY,
	`title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_turn_id` text,
	`origin_doc_path` text,
	`origin_note_id` text,
	`provider_id` text,
	`provider_thread_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "threads_origin_shape_check" CHECK("origin_note_id" IS NULL OR "origin_doc_path" IS NOT NULL),
	CONSTRAINT "threads_provider_session_check" CHECK("provider_thread_id" IS NULL OR "provider_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_thread_sequence_idx` ON `events` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_origin_idx` ON `events` (`origin_device_id`,`origin_device_seq`);--> statement-breakpoint
CREATE INDEX `events_thread_turn_type_item_sequence_idx` ON `events` (`thread_id`,`turn_id`,`type`,`item_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `pending_fills_not_before_idx` ON `pending_fills` (`not_before`);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_interactions_thread_request_idx` ON `pending_interactions` (`thread_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_status_created_idx` ON `pending_interactions` (`thread_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_sort_idx` ON `queued_thread_messages` (`thread_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_device_seq_idx` ON `sync_outbox` (`device_seq`);--> statement-breakpoint
CREATE INDEX `threads_live_updated_id_idx` ON `threads` (`updated_at`,`id`) WHERE "threads"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `threads_archived_updated_id_idx` ON `threads` (`updated_at`,`id`) WHERE "threads"."archived_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO `meta` (`key`, `value`) VALUES ('schema_version', '1');--> statement-breakpoint
INSERT INTO `sync_state` (`id`) VALUES (1);
