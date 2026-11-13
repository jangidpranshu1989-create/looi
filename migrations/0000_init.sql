CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_code` text NOT NULL,
	`mission_id` integer NOT NULL,
	`post_id` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'click' NOT NULL,
	`ts` integer NOT NULL,
	`referrer` text DEFAULT '' NOT NULL,
	`ua` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`angle` text DEFAULT '' NOT NULL,
	`template` text DEFAULT '' NOT NULL,
	`format` text DEFAULT 'square' NOT NULL,
	`copy` text DEFAULT '{}' NOT NULL,
	`poster_file` text DEFAULT '' NOT NULL,
	`video_file` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`favicon` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'approval' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`channel_ids` text DEFAULT '[]' NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`site` text DEFAULT '{}' NOT NULL,
	`report` text DEFAULT '{}' NOT NULL,
	`brief` text DEFAULT '{}' NOT NULL,
	`strategy` text DEFAULT '{}' NOT NULL,
	`health_score` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`last_check_at` integer DEFAULT 0 NOT NULL,
	`next_check_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer DEFAULT 0 NOT NULL,
	`approval_id` integer DEFAULT 0 NOT NULL,
	`ts` integer NOT NULL,
	`kind` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`read` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`order_id` text NOT NULL,
	`payment_id` text DEFAULT '' NOT NULL,
	`plan` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer DEFAULT 0 NOT NULL,
	`utr_at` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`prev_plan` text DEFAULT '' NOT NULL,
	`prev_until` integer DEFAULT 0 NOT NULL,
	`prev_start` integer DEFAULT 0 NOT NULL,
	`provisional` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_order_id_unique` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `playbooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`channel` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`mission_id` integer NOT NULL,
	`creative_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`channel_type` text NOT NULL,
	`link_code` text NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`external_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`metrics` text DEFAULT '{}' NOT NULL,
	`published_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ua` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'builtin' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`builtin_fallback` integer DEFAULT true NOT NULL,
	`ai_visuals` integer DEFAULT true NOT NULL,
	`interval_minutes` integer DEFAULT 150 NOT NULL,
	`default_mode` text DEFAULT 'approval' NOT NULL,
	`public_base_url` text DEFAULT '' NOT NULL,
	`psi_key` text DEFAULT '' NOT NULL,
	`brand_voice` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'English' NOT NULL,
	`composio_key` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mission_id` integer NOT NULL,
	`ts` integer NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`pass` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`plan_until` integer DEFAULT 0 NOT NULL,
	`plan_start` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`limit_notice` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);