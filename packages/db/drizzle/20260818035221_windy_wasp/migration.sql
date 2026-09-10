CREATE TABLE `sync_applied_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`device_seq` integer NOT NULL,
	`thread_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_device_seq_idx` ON `sync_outbox` (`device_seq`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_device_seq` integer DEFAULT 0 NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	CONSTRAINT "sync_state_singleton_check" CHECK("sync_state"."id" = 1)
);

--> statement-breakpoint
UPDATE `meta` SET `value` = '6' WHERE `key` = 'schema_version';