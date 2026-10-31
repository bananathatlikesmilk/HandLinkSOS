CREATE TABLE lgu (
 id text PRIMARY KEY NOT NULL,
 name text NOT NULL UNIQUE,
 boundary text CHECK (boundary IS NULL OR json_valid(boundary)),
 active integer NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
 activated_at integer,
 created_at integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
--> statement-breakpoint
INSERT INTO lgu (id,name,active) VALUES ('legacy','Existing LGU',1);
--> statement-breakpoint
CREATE TABLE staff_lgu (
 user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE restrict,
 lgu_id text NOT NULL REFERENCES lgu(id) ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO staff_lgu (user_id,lgu_id) SELECT id,'legacy' FROM user WHERE role='dispatcher';
--> statement-breakpoint
CREATE TABLE incident_lgu (
 incident_id text PRIMARY KEY NOT NULL REFERENCES incident(id) ON DELETE restrict,
 lgu_id text REFERENCES lgu(id) ON DELETE restrict,
 reason text NOT NULL
);
--> statement-breakpoint
INSERT INTO incident_lgu (incident_id,lgu_id,reason) SELECT id,'legacy','legacy' FROM incident;
--> statement-breakpoint
CREATE INDEX incident_lgu_scope_idx ON incident_lgu(lgu_id);
--> statement-breakpoint
CREATE TABLE lgu_routing_audit (
 id text PRIMARY KEY NOT NULL,
 incident_id text NOT NULL REFERENCES incident(id) ON DELETE restrict,
 from_lgu_id text REFERENCES lgu(id) ON DELETE restrict,
 to_lgu_id text NOT NULL REFERENCES lgu(id) ON DELETE restrict,
 actor_user_id text NOT NULL REFERENCES user(id) ON DELETE restrict,
 created_at integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
