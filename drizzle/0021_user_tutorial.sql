CREATE TABLE user_tutorial (
  user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  dismissed_at integer NOT NULL
);
