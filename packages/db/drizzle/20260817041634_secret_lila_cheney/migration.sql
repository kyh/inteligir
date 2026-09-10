CREATE INDEX `threads_origin_doc_idx` ON `threads` (`origin_doc_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_origin_anchor_idx` ON `threads` (`origin_anchor`);
--> statement-breakpoint
UPDATE `meta` SET `value` = '4' WHERE `key` = 'schema_version';