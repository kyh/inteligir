-- Written by packages/db/scripts/object-ddl.ts from src/note/schema.ts: edit the schema,
-- then run `pnpm --filter @repo/db ddl`.

CREATE TABLE `applied_ops` (
	`op_id` text PRIMARY KEY,
	`answer` text NOT NULL
);

CREATE TABLE `note_meta` (
	`id` integer PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`projected` integer DEFAULT 0 NOT NULL,
	`dirty_at` integer,
	`retry_at` integer,
	`seed_pending` integer DEFAULT 0 NOT NULL,
	`full` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`purged` integer DEFAULT 0 NOT NULL,
	`person_edited` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "note_meta_one" CHECK("id" = 1)
);

CREATE TABLE `note_updates` (
	`id` integer PRIMARY KEY,
	`bytes` blob NOT NULL
);

CREATE TABLE `snapshot_parts` (
	`part` integer PRIMARY KEY,
	`bytes` blob NOT NULL
);

CREATE TABLE `turn_cursors` (
	`change_set_id` text PRIMARY KEY,
	`seq` integer NOT NULL,
	`state_vector` blob NOT NULL,
	`at` integer NOT NULL
);

CREATE TABLE `turn_log` (
	`change_set_id` text NOT NULL,
	`seq` integer NOT NULL,
	`part` integer NOT NULL,
	`kind` text NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT `turn_log_pk` PRIMARY KEY(`change_set_id`, `seq`, `part`),
	CONSTRAINT "turn_log_kind" CHECK("kind" IN ('pre', 'turn'))
);

CREATE INDEX `turn_cursors_at` ON `turn_cursors` (`at`);
