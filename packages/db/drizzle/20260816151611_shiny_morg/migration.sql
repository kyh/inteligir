ALTER TABLE `threads` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `provider_thread_id` text;--> statement-breakpoint
UPDATE `meta` SET `value` = '3' WHERE `key` = 'schema_version';
