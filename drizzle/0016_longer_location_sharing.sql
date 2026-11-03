-- The migrator runs this atomically with foreign keys enabled. Preserve dependent rows
-- before SQLite's DROP TABLE cascades, and temporarily detach nullable notification links.
CREATE TABLE `__new_location_session` (
 `id` text PRIMARY KEY NOT NULL,
 `owner_profile_id` text NOT NULL REFERENCES `user_profile`(`id`) ON DELETE restrict,
 `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
 `expires_at` integer NOT NULL,
 `cancelled_at` integer,
 `expiry_notified_at` integer,
 CONSTRAINT `location_duration` CHECK (`expires_at` - `created_at` between 60000 and 86400000),
 CONSTRAINT `location_cancel_time` CHECK (`cancelled_at` is null or `cancelled_at` >= `created_at`)
);
--> statement-breakpoint
INSERT INTO `__new_location_session` SELECT * FROM `location_session`;
--> statement-breakpoint
CREATE TEMP TABLE `__sharing_duration_recipients` AS SELECT * FROM `location_recipient`;
--> statement-breakpoint
CREATE TEMP TABLE `__sharing_duration_points` AS SELECT * FROM `location_point`;
--> statement-breakpoint
CREATE TEMP TABLE `__sharing_duration_notifications` AS SELECT `id`, `location_session_id` FROM `notification` WHERE `location_session_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `notification` SET `location_session_id` = NULL WHERE `location_session_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `location_session`;
--> statement-breakpoint
ALTER TABLE `__new_location_session` RENAME TO `location_session`;
--> statement-breakpoint
CREATE INDEX `location_expiry_idx` ON `location_session` (`expires_at`);
--> statement-breakpoint
INSERT INTO `location_recipient` SELECT * FROM `__sharing_duration_recipients`;
--> statement-breakpoint
INSERT INTO `location_point` SELECT * FROM `__sharing_duration_points`;
--> statement-breakpoint
UPDATE `notification` SET `location_session_id` = (SELECT `location_session_id` FROM `__sharing_duration_notifications` WHERE `__sharing_duration_notifications`.`id` = `notification`.`id`) WHERE `id` IN (SELECT `id` FROM `__sharing_duration_notifications`);
--> statement-breakpoint
DROP TABLE `__sharing_duration_recipients`;
--> statement-breakpoint
DROP TABLE `__sharing_duration_points`;
--> statement-breakpoint
DROP TABLE `__sharing_duration_notifications`;
