-- Written by packages/db/scripts/object-ddl.ts from src/thread/schema.ts: edit the schema,
-- then run `pnpm --filter @repo/db ddl`.

CREATE TABLE `model_calls` (
	`call_id` text PRIMARY KEY,
	`turn` integer NOT NULL,
	`step` integer NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`isolate` text NOT NULL,
	`request_sha` text,
	CONSTRAINT "model_calls_status" CHECK("status" IN ('streaming', 'done', 'cut', 'failed', 'cancelled'))
);

CREATE TABLE `definition` (
	`id` integer PRIMARY KEY,
	`hash` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`system` text NOT NULL,
	`tools` text NOT NULL,
	`since_seq` integer NOT NULL UNIQUE
);

CREATE TABLE `thread_meta` (
	`id` integer PRIMARY KEY,
	`push_seq` integer DEFAULT 0 NOT NULL,
	`rules_hash` text,
	CONSTRAINT "thread_meta_one" CHECK("id" = 1)
);

CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY,
	`json` text NOT NULL
);

CREATE TABLE `transcript` (
	`seq` integer PRIMARY KEY,
	`turn` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "transcript_role" CHECK("role" IN ('user', 'assistant', 'system'))
);

CREATE TABLE `turns` (
	`turn` integer PRIMARY KEY,
	`op_id` text NOT NULL UNIQUE,
	`content` text NOT NULL,
	`rules` text,
	`rules_hash` text,
	`status` text NOT NULL,
	`started` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "turns_status" CHECK("status" IN ('running', 'awaiting_approval', 'ended')),
	CONSTRAINT "turns_started" CHECK("started" IN (0, 1)),
	CONSTRAINT "turns_cancel_requested" CHECK("cancel_requested" IN (0, 1))
);

CREATE TABLE `tool_calls` (
	`tool_use_id` text PRIMARY KEY,
	`turn` integer NOT NULL,
	`msg_seq` integer NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`result` text,
	`is_error` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tool_calls_status" CHECK("status" IN ('pending', 'awaiting_approval', 'running', 'done')),
	CONSTRAINT "tool_calls_decision" CHECK("decision" IN ('approved', 'denied')),
	CONSTRAINT "tool_calls_is_error" CHECK("is_error" IN (0, 1))
);

CREATE INDEX `model_calls_step` ON `model_calls` (`turn`,`step`,`attempt`);
CREATE INDEX `tool_calls_message` ON `tool_calls` (`msg_seq`,`idx`);
