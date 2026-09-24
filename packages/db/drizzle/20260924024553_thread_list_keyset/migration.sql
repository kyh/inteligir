DROP INDEX IF EXISTS `threads_live_updated_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `threads_archived_updated_idx`;--> statement-breakpoint
CREATE INDEX `threads_live_updated_id_idx` ON `threads` (`updated_at`,`id`) WHERE "threads"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `threads_archived_updated_id_idx` ON `threads` (`updated_at`,`id`) WHERE "threads"."archived_at" IS NOT NULL;--> statement-breakpoint
UPDATE `meta` SET `value` = '14' WHERE `key` = 'schema_version';
