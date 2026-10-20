CREATE TABLE `incident_addendum` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "addendum_notes_length" CHECK(length(trim("incident_addendum"."notes")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `addendum_incident_idx` ON `incident_addendum` (`incident_id`, `created_at`);
