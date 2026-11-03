INSERT INTO lgu (id, name, active) VALUES ('provincial-intake', 'Provincial coordination (system)', 1);
--> statement-breakpoint
CREATE TABLE incident_intake (
  incident_id text PRIMARY KEY NOT NULL REFERENCES incident(id) ON DELETE RESTRICT,
  suggested_lgu_id text REFERENCES lgu(id) ON DELETE RESTRICT,
  suggestion_reason text NOT NULL
);
