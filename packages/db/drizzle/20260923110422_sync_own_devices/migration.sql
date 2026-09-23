CREATE TABLE `sync_own_devices` (
	`device_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
UPDATE `meta` SET `value` = '11' WHERE `key` = 'schema_version';
