PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_turn_id` text,
	`origin_doc_path` text,
	`origin_anchor` text,
	`provider_id` text,
	`provider_thread_id` text,
	`write_mode` text DEFAULT 'direct' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "threads_origin_pair_check" CHECK(("__new_threads"."origin_anchor" IS NULL OR "__new_threads"."origin_doc_path" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "title", "status", "active_turn_id", "origin_doc_path", "origin_anchor", "provider_id", "provider_thread_id", "write_mode", "archived_at", "created_at", "updated_at") SELECT "id", "title", "status", "active_turn_id", "origin_doc_path", "origin_anchor", "provider_id", "provider_thread_id", "write_mode", "archived_at", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `threads_live_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `threads_archived_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_origin_doc_idx` ON `threads` (`origin_doc_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_origin_anchor_idx` ON `threads` (`origin_anchor`);--> statement-breakpoint
UPDATE `meta` SET `value` = '8' WHERE `key` = 'schema_version';
