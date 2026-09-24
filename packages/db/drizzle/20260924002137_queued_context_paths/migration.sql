ALTER TABLE `queued_thread_messages` ADD `context_paths` text;--> statement-breakpoint
UPDATE `meta` SET `value` = '13' WHERE `key` = 'schema_version';
