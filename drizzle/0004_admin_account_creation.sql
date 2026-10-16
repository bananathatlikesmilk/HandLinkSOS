PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "account_audit_action" CHECK("__new_account_audit"."action" in ('dispatcher_created','admin_created','deactivated','reactivated'))
);
--> statement-breakpoint
INSERT INTO `__new_account_audit`("id", "actor_user_id", "target_user_id", "action", "created_at") SELECT "id", "actor_user_id", "target_user_id", "action", "created_at" FROM `account_audit`;--> statement-breakpoint
DROP TABLE `account_audit`;--> statement-breakpoint
ALTER TABLE `__new_account_audit` RENAME TO `account_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `account_audit_actor_time_idx` ON `account_audit` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_audit_target_time_idx` ON `account_audit` (`target_user_id`,`created_at`);