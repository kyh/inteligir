ALTER TABLE `pending_interactions` ADD `relay` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `dispatch_id` text;--> statement-breakpoint
UPDATE `meta` SET `value` = '17' WHERE `key` = 'schema_version';
