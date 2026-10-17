CREATE TABLE `push_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`device_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notification`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_delivery_state" CHECK("push_delivery"."state" in ('pending','sent','skipped','failed')),
	CONSTRAINT "push_delivery_attempts" CHECK("push_delivery"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_delivery_once` ON `push_delivery` (`notification_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `push_delivery_pending` ON `push_delivery` (`state`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `device` ADD `session_id` text REFERENCES session(id) ON DELETE CASCADE;
