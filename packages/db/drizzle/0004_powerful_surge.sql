CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text,
	`doc_path` text NOT NULL,
	`base_rev` text,
	`base_hash` text,
	`base_content` text NOT NULL,
	`proposed_content` text,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`accepted_hunks` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "proposals_has_change_check" CHECK("proposals"."base_hash" IS NOT NULL OR "proposals"."proposed_content" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_thread_doc_pending_idx` ON `proposals` (`thread_id`,`doc_path`) WHERE "proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `proposals_doc_status_idx` ON `proposals` (`doc_path`,`status`);--> statement-breakpoint
CREATE INDEX `proposals_thread_status_idx` ON `proposals` (`thread_id`,`status`);--> statement-breakpoint
ALTER TABLE `threads` ADD `write_mode` text DEFAULT 'direct' NOT NULL;
--> statement-breakpoint
UPDATE `meta` SET `value` = '5' WHERE `key` = 'schema_version';