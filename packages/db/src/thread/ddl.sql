-- Written by packages/db/scripts/object-ddl.ts from src/thread/schema.ts: edit the schema,
-- then run `pnpm --filter @repo/db ddl`.

CREATE TABLE `definition` (
	`id` integer PRIMARY KEY,
	`hash` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`system` text NOT NULL,
	`rules` text,
	`tools` text NOT NULL,
	`since_seq` integer NOT NULL UNIQUE
);

CREATE TABLE `thread_meta` (
	`id` integer PRIMARY KEY,
	`push_seq` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "thread_meta_one" CHECK("id" = 1)
);

CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY,
	`turn` integer NOT NULL,
	`events` text NOT NULL
);

CREATE TABLE `transcript` (
	`seq` integer PRIMARY KEY,
	`turn` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "transcript_role" CHECK("role" IN ('user', 'assistant'))
);

CREATE TABLE `turns` (
	`turn` integer PRIMARY KEY,
	`state` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "turns_state" CHECK("state" IN ('running', 'stopping', 'ended'))
);

CREATE TABLE `tool_calls` (
	`tool_use_id` text PRIMARY KEY,
	`turn` integer NOT NULL,
	`msg_seq` integer NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`input` text NOT NULL,
	`state` text NOT NULL,
	`until` integer,
	`result` text,
	`is_error` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tool_calls_state" CHECK("state" IN ('asked', 'awaiting', 'approved', 'denied', 'running', 'answered')),
	CONSTRAINT "tool_calls_until" CHECK(("state" = 'awaiting') = ("until" IS NOT NULL)),
	CONSTRAINT "tool_calls_answer" CHECK(("state" = 'answered') = ("result" IS NOT NULL)),
	CONSTRAINT "tool_calls_is_error" CHECK("is_error" IN (0, 1))
);

CREATE INDEX `tool_calls_message` ON `tool_calls` (`msg_seq`,`idx`);
