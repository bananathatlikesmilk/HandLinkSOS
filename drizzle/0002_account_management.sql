CREATE TABLE `account_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "account_audit_action" CHECK("account_audit"."action" in ('dispatcher_created','deactivated','reactivated'))
);
--> statement-breakpoint
CREATE INDEX `account_audit_actor_time_idx` ON `account_audit` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_audit_target_time_idx` ON `account_audit` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_normalized_unique` ON `user` (lower("email"));