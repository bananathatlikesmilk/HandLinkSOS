CREATE TABLE `incident_person_location` (
	`incident_id` text PRIMARY KEY NOT NULL REFERENCES `incident`(`id`) ON DELETE restrict,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy` real NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT `incident_person_coordinates` CHECK (`latitude` BETWEEN -90 AND 90 AND `longitude` BETWEEN -180 AND 180),
	CONSTRAINT `incident_person_accuracy` CHECK (`accuracy` >= 0)
);
