CREATE TABLE `admins` (
	`id` text PRIMARY KEY NOT NULL,
	`slack_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`device_id` text NOT NULL,
	`date` text NOT NULL,
	`post_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`device_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`device_id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`last_nickname` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_public_id_unique` ON `devices` (`public_id`);--> statement-breakpoint
CREATE TABLE `hashtags` (
	`tag` text NOT NULL,
	`post_id` text,
	`reply_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hearts` (
	`post_id` text NOT NULL,
	`device_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`post_id`, `device_id`)
);
--> statement-breakpoint
CREATE TABLE `judge_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`image_hash` text NOT NULL,
	`kira_score` integer NOT NULL,
	`kira_reason` text NOT NULL,
	`faces` text NOT NULL,
	`nickname` text NOT NULL,
	`caption` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `map` (
	`key` text PRIMARY KEY NOT NULL,
	`image_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`description` text,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`nickname` text NOT NULL,
	`caption` text NOT NULL,
	`place_id` text,
	`topic` text NOT NULL,
	`image_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`kira_score` integer NOT NULL,
	`kira_reason` text NOT NULL,
	`heart_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`report_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`device_id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`device_id` text NOT NULL,
	`nickname` text NOT NULL,
	`body` text NOT NULL,
	`report_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`device_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_device` ON `reports` (`target_type`,`target_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
