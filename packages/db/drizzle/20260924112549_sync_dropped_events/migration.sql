ALTER TABLE `sync_state` ADD `dropped_events` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `meta` SET `value` = '16' WHERE `key` = 'schema_version';
