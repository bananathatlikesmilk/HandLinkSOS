CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`incident_id` text,
	`location_session_id` text,
	`type` text NOT NULL,
	`delivery_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`delivered_at` integer,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_session_id`) REFERENCES `location_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_type" CHECK("__new_notification"."type" in ('sos','location_shared','location_expiring','location_expired','trusted_request'))
);
--> statement-breakpoint
INSERT INTO `__new_notification`("id", "user_id", "incident_id", "location_session_id", "type", "delivery_key", "created_at", "delivered_at", "read_at") SELECT "id", "user_id", "incident_id", "location_session_id", "type", "delivery_key", "created_at", "delivered_at", "read_at" FROM `notification`;--> statement-breakpoint
DROP TABLE `notification`;--> statement-breakpoint
ALTER TABLE `__new_notification` RENAME TO `notification`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_key_unique` ON `notification` (`delivery_key`);--> statement-breakpoint
CREATE INDEX `notification_user_time_idx` ON `notification` (`user_id`,`created_at`);
