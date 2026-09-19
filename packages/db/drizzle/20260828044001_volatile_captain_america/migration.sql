DROP TABLE `proposals`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_turn_id` text,
	`origin_doc_path` text,
	`provider_id` text,
	`provider_thread_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "title", "status", "active_turn_id", "origin_doc_path", "provider_id", "provider_thread_id", "archived_at", "created_at", "updated_at") SELECT "id", "title", "status", "active_turn_id", "origin_doc_path", "provider_id", "provider_thread_id", "archived_at", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `threads_live_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `threads_archived_updated_idx` ON `threads` (`updated_at`) WHERE "threads"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_origin_doc_idx` ON `threads` (`origin_doc_path`);--> statement-breakpoint
UPDATE `meta` SET `value` = '10' WHERE `key` = 'schema_version';