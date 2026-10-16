CREATE TABLE `call_session` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`provider_call_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "call_status" CHECK("call_session"."status" in ('pending','connected','ended','failed')),
	CONSTRAINT "call_times" CHECK("call_session"."ended_at" is null or "call_session"."ended_at" >= "call_session"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_session_provider_call_id_unique` ON `call_session` (`provider_call_id`);--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`push_token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_platform" CHECK("device"."platform" in ('android','ios'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_push_token_unique` ON `device` (`push_token`);--> statement-breakpoint
CREATE INDEX `device_user_idx` ON `device` (`user_id`);--> statement-breakpoint
CREATE TABLE `emergency_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`linked_user_id` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`relationship` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_profile_idx` ON `emergency_contact` (`profile_id`);--> statement-breakpoint
CREATE TABLE `incident` (
	`id` text PRIMARY KEY NOT NULL,
	`person_profile_id` text NOT NULL,
	`caller_user_id` text NOT NULL,
	`caller_name` text NOT NULL,
	`caller_relationship` text DEFAULT '' NOT NULL,
	`dispatcher_user_id` text,
	`status` text DEFAULT 'Not assigned' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`location_label` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`confirmed_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`person_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`caller_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dispatcher_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "incident_coordinates" CHECK("incident"."latitude" between -90 and 90 and "incident"."longitude" between -180 and 180),
	CONSTRAINT "incident_status" CHECK("incident"."status" in ('Not assigned','In progress','On route','Resolved')),
	CONSTRAINT "incident_assignment" CHECK(("incident"."status" = 'Not assigned' and "incident"."dispatcher_user_id" is null and "incident"."confirmed_at" is null) or ("incident"."status" <> 'Not assigned' and "incident"."dispatcher_user_id" is not null and "incident"."confirmed_at" is not null)),
	CONSTRAINT "incident_resolution" CHECK(("incident"."status" = 'Resolved' and "incident"."ended_at" is not null and "incident"."ended_at" >= "incident"."created_at") or ("incident"."status" <> 'Resolved' and "incident"."ended_at" is null))
);
--> statement-breakpoint
CREATE INDEX `incident_status_idx` ON `incident` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `incident_person_idx` ON `incident` (`person_profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `incident_retry_unique` ON `incident` (`caller_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `incident_event` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`type` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_type" CHECK("incident_event"."type" in ('created','confirmed','on_route','resolved','note')),
	CONSTRAINT "event_notes_length" CHECK(length("incident_event"."notes") <= 2000)
);
--> statement-breakpoint
CREATE INDEX `event_incident_idx` ON `incident_event` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `location_point` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy` real NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `location_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "point_coordinates" CHECK("location_point"."latitude" between -90 and 90 and "location_point"."longitude" between -180 and 180),
	CONSTRAINT "point_accuracy" CHECK("location_point"."accuracy" >= 0)
);
--> statement-breakpoint
CREATE INDEX `point_session_time_idx` ON `location_point` (`session_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `location_recipient` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `location_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_recipient_unique` ON `location_recipient` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `location_recipient_user_idx` ON `location_recipient` (`user_id`);--> statement-breakpoint
CREATE TABLE `location_session` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	`expiry_notified_at` integer,
	FOREIGN KEY (`owner_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "location_duration" CHECK("location_session"."expires_at" - "location_session"."created_at" between 60000 and 14400000),
	CONSTRAINT "location_cancel_time" CHECK("location_session"."cancelled_at" is null or "location_session"."cancelled_at" >= "location_session"."created_at")
);
--> statement-breakpoint
CREATE INDEX `location_expiry_idx` ON `location_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `medical_profile` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`blood_type` text,
	`chronic_condition` text DEFAULT '' NOT NULL,
	`allergies` text DEFAULT '' NOT NULL,
	`current_medications` text DEFAULT '' NOT NULL,
	`additional_information` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "medical_blood_type" CHECK("medical_profile"."blood_type" is null or "medical_profile"."blood_type" in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'))
);
--> statement-breakpoint
CREATE TABLE `notification` (
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
	CONSTRAINT "notification_type" CHECK("notification"."type" in ('sos','location_shared','location_expired','trusted_request'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_key_unique` ON `notification` (`delivery_key`);--> statement-breakpoint
CREATE INDEX `notification_user_time_idx` ON `notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birthday` text NOT NULL,
	`sex` text NOT NULL,
	`phone` text NOT NULL,
	`deactivated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "profile_sex" CHECK("user_profile"."sex" in ('Female','Male','Other','Prefer not to say')),
	CONSTRAINT "profile_names" CHECK(length(trim("user_profile"."first_name")) between 1 and 100 and length(trim("user_profile"."last_name")) between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_user_id_unique` ON `user_profile` (`user_id`);--> statement-breakpoint
CREATE TABLE `qr_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_profile_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`owner_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "qr_expiry" CHECK("qr_invitation"."expires_at" > "qr_invitation"."created_at"),
	CONSTRAINT "qr_hash" CHECK(length("qr_invitation"."token_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qr_invitation_token_hash_unique` ON `qr_invitation` (`token_hash`);--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "report_summary_length" CHECK(length("report"."summary") between 1 and 4000),
	CONSTRAINT "report_review_pair" CHECK(("report"."reviewed_at" is null and "report"."reviewed_by_user_id" is null) or ("report"."reviewed_at" is not null and "report"."reviewed_by_user_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_incident_id_unique` ON `report` (`incident_id`);--> statement-breakpoint
CREATE TABLE `trusted_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_profile_id` text NOT NULL,
	`requester_profile_id` text NOT NULL,
	`invitation_id` text,
	`relationship` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`approved_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`owner_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invitation_id`) REFERENCES `qr_invitation`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trusted_not_self" CHECK("trusted_connection"."owner_profile_id" <> "trusted_connection"."requester_profile_id"),
	CONSTRAINT "trusted_status" CHECK("trusted_connection"."status" in ('pending','approved','revoked')),
	CONSTRAINT "trusted_approval" CHECK("trusted_connection"."status" <> 'approved' or "trusted_connection"."approved_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_pair_unique` ON `trusted_connection` (`owner_profile_id`,`requester_profile_id`);--> statement-breakpoint
CREATE TABLE `verification_request` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `trusted_connection`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "verification_expiry" CHECK("verification_request"."expires_at" > "verification_request"."created_at"),
	CONSTRAINT "verification_hash" CHECK(length("verification_request"."code_hash") = 64),
	CONSTRAINT "verification_attempts" CHECK("verification_request"."attempts" between 0 and 5),
	CONSTRAINT "verification_purpose" CHECK("verification_request"."purpose" in ('email','recovery','trusted_approval','qr_access')),
	CONSTRAINT "verification_binding" CHECK("verification_request"."purpose" <> 'trusted_approval' or "verification_request"."connection_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `verification_user_purpose_idx` ON `verification_request` (`user_id`,`purpose`);