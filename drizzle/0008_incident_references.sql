CREATE TABLE `incident_reference` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "incident_reference_positive" CHECK("incident_reference"."number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_reference_incident_id_unique` ON `incident_reference` (`incident_id`);
--> statement-breakpoint
INSERT INTO `incident_reference` (`incident_id`)
SELECT `id` FROM `incident` ORDER BY `created_at`, `id`;
--> statement-breakpoint
CREATE TRIGGER `incident_reference_allocate` AFTER INSERT ON `incident`
BEGIN
	INSERT INTO `incident_reference` (`incident_id`) VALUES (NEW.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `incident_reference_immutable` BEFORE UPDATE ON `incident_reference`
WHEN NEW.`number` <> OLD.`number` OR NEW.`incident_id` <> OLD.`incident_id`
BEGIN
	SELECT RAISE(ABORT, 'Incident references cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER `incident_reference_keep` BEFORE DELETE ON `incident_reference`
BEGIN
	SELECT RAISE(ABORT, 'Incident references cannot be removed');
END;
