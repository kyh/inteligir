ALTER TABLE `sync_state` ADD `skipped_from_seq` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `skipped_by_build` text;--> statement-breakpoint
DROP INDEX IF EXISTS `events_thread_type_sequence_idx`;--> statement-breakpoint
UPDATE `meta` SET `value` = '12' WHERE `key` = 'schema_version';
