-- Rebuild only the parent table inside the migrator transaction. Child rows and references stay intact.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_incident` (
	`id` text PRIMARY KEY NOT NULL,
	`person_profile_id` text,
 `stranger_name` text DEFAULT '' NOT NULL,
 `emergency_description` text DEFAULT '' NOT NULL,
 `location_source` text DEFAULT 'device' NOT NULL,
	`caller_user_id` text NOT NULL,
	`caller_name` text NOT NULL,
	`caller_relationship` text DEFAULT '' NOT NULL,
	`dispatcher_user_id` text,
	`status` text DEFAULT 'Not assigned' NOT NULL,
	`latitude` real,
	`longitude` real,
	`location_label` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`confirmed_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`person_profile_id`) REFERENCES `user_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`caller_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dispatcher_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "incident_coordinates" CHECK((latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180) OR (person_profile_id IS NULL AND location_source = 'reported' AND latitude IS NULL AND longitude IS NULL)),
	CONSTRAINT "incident_status" CHECK("__new_incident"."status" in ('Not assigned','In progress','On route','Resolved')),
	CONSTRAINT "incident_assignment" CHECK(("__new_incident"."status" = 'Not assigned' and "__new_incident"."dispatcher_user_id" is null and "__new_incident"."confirmed_at" is null) or ("__new_incident"."status" <> 'Not assigned' and "__new_incident"."dispatcher_user_id" is not null and "__new_incident"."confirmed_at" is not null)),
	CONSTRAINT "incident_resolution" CHECK(("__new_incident"."status" = 'Resolved' and "__new_incident"."ended_at" is not null and "__new_incident"."ended_at" >= "__new_incident"."created_at") or ("__new_incident"."status" <> 'Resolved' and "__new_incident"."ended_at" is null)),
 CONSTRAINT incident_subject CHECK (
 (person_profile_id IS NOT NULL AND stranger_name = '' AND emergency_description = '' AND location_source = 'device') OR
 (person_profile_id IS NULL AND length(trim(emergency_description)) BETWEEN 1 AND 1000 AND length(stranger_name) <= 100 AND location_source IN ('device','reported') AND (location_source <> 'reported' OR length(trim(location_label)) > 0))
 )
);
--> statement-breakpoint
INSERT INTO __new_incident (id,person_profile_id,caller_user_id,caller_name,caller_relationship,dispatcher_user_id,status,latitude,longitude,location_label,idempotency_key,created_at,confirmed_at,ended_at) SELECT id,person_profile_id,caller_user_id,caller_name,caller_relationship,dispatcher_user_id,status,latitude,longitude,location_label,idempotency_key,created_at,confirmed_at,ended_at FROM incident;--> statement-breakpoint
DROP TABLE incident;--> statement-breakpoint
ALTER TABLE __new_incident RENAME TO incident;--> statement-breakpoint
CREATE INDEX incident_status_idx ON incident(status,created_at);--> statement-breakpoint
CREATE INDEX incident_person_idx ON incident(person_profile_id);--> statement-breakpoint
CREATE UNIQUE INDEX incident_retry_unique ON incident(caller_user_id,idempotency_key);--> statement-breakpoint
CREATE TRIGGER incident_reference_allocate AFTER INSERT ON incident
BEGIN
 INSERT INTO incident_reference(incident_id) VALUES (NEW.id);
END;--> statement-breakpoint
-- Abort and roll back if rebuilding left any orphan. Clear deferred DROP bookkeeping only after this check.
CREATE TEMP TABLE incident_migration_integrity (violations INTEGER CHECK(violations = 0));--> statement-breakpoint
INSERT INTO incident_migration_integrity SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE incident_migration_integrity;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
