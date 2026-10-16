CREATE TABLE `incident_cancellation` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`reviewed_at` integer,
	`reviewed_by_user_id` text,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cancellation_reason" CHECK(length(trim("incident_cancellation"."reason")) between 1 and 500),
	CONSTRAINT "cancellation_decision" CHECK("incident_cancellation"."decision" in ('pending','approved','rejected')),
	CONSTRAINT "cancellation_review" CHECK(("incident_cancellation"."decision" = 'pending' and "incident_cancellation"."reviewed_at" is null and "incident_cancellation"."reviewed_by_user_id" is null) or ("incident_cancellation"."decision" <> 'pending' and "incident_cancellation"."reviewed_at" is not null and "incident_cancellation"."reviewed_by_user_id" is not null and "incident_cancellation"."reviewed_at" >= "incident_cancellation"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_cancellation_incident_id_unique` ON `incident_cancellation` (`incident_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_incident_event` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`type` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_type" CHECK("__new_incident_event"."type" in ('created','confirmed','on_route','resolved','note','cancellation_requested','cancellation_approved','cancellation_rejected')),
	CONSTRAINT "event_notes_length" CHECK(length("__new_incident_event"."notes") <= 2000)
);
--> statement-breakpoint
INSERT INTO `__new_incident_event`("id", "incident_id", "actor_user_id", "type", "notes", "created_at") SELECT "id", "incident_id", "actor_user_id", "type", "notes", "created_at" FROM `incident_event`;--> statement-breakpoint
DROP TABLE `incident_event`;--> statement-breakpoint
ALTER TABLE `__new_incident_event` RENAME TO `incident_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `event_incident_idx` ON `incident_event` (`incident_id`,`created_at`);