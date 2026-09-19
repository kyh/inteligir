ALTER TABLE `events` ADD `origin_device_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `origin_device_seq` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `events_origin_idx` ON `events` (`origin_device_id`,`origin_device_seq`);
--> statement-breakpoint
UPDATE `meta` SET `value` = '7' WHERE `key` = 'schema_version';