ALTER TABLE `threads` ADD `origin_note_id` text;--> statement-breakpoint
DROP INDEX IF EXISTS `threads_origin_doc_idx`;--> statement-breakpoint
UPDATE `meta` SET `value` = '14' WHERE `key` = 'schema_version';
