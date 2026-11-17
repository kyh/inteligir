-- Written by packages/db/scripts/object-ddl.ts from src/d1/schema.ts: edit the schema,
-- then run `pnpm --filter @repo/db ddl`.

CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `invite_code` (
	`code` text PRIMARY KEY,
	`redeemed_by` text,
	`redeemed_at` integer
);

CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);

CREATE TABLE `revoked_grant` (
	`grant_id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_revoked_grant_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);

CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);
CREATE INDEX `revoked_grant_user_id_idx` ON `revoked_grant` (`user_id`);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
