CREATE TABLE `ai_summary_request` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`source_note_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`reviewed_at` integer,
	`reviewed_by_user_id` text,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_note_id`) REFERENCES `incident_event`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_request_hash" CHECK(length("ai_summary_request"."input_hash") = 64),
	CONSTRAINT "ai_request_model" CHECK(length("ai_summary_request"."model") between 1 and 100),
	CONSTRAINT "ai_request_status" CHECK("ai_summary_request"."status" in ('pending','completed','failed')),
	CONSTRAINT "ai_request_result" CHECK(("ai_summary_request"."status"='pending' and "ai_summary_request"."summary" is null and "ai_summary_request"."finished_at" is null) or ("ai_summary_request"."status"='failed' and "ai_summary_request"."summary" is null and "ai_summary_request"."finished_at" is not null and "ai_summary_request"."finished_at" >= "ai_summary_request"."created_at") or ("ai_summary_request"."status"='completed' and "ai_summary_request"."summary" is not null and length(trim("ai_summary_request"."summary")) between 1 and 1500 and "ai_summary_request"."finished_at" is not null and "ai_summary_request"."finished_at" >= "ai_summary_request"."created_at")),
	CONSTRAINT "ai_request_review" CHECK(("ai_summary_request"."reviewed_at" is null and "ai_summary_request"."reviewed_by_user_id" is null) or ("ai_summary_request"."status"='completed' and "ai_summary_request"."reviewed_at" is not null and "ai_summary_request"."reviewed_by_user_id" is not null and "ai_summary_request"."reviewed_at" >= "ai_summary_request"."finished_at"))
);
--> statement-breakpoint
CREATE INDEX `ai_request_actor_time_idx` ON `ai_summary_request` (`requested_by_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_request_incident_time_idx` ON `ai_summary_request` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_request_one_pending_idx` ON `ai_summary_request` (`incident_id`) WHERE "ai_summary_request"."status" = 'pending';--> statement-breakpoint
ALTER TABLE `report` ADD `summary_request_id` text REFERENCES ai_summary_request(id);