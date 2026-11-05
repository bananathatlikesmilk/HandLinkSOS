CREATE TABLE emergency_phone_setting (
  id text PRIMARY KEY NOT NULL CHECK (id = 'sos'),
  number text NOT NULL CHECK (
    length(number) BETWEEN 3 AND 16 AND (
      (number NOT GLOB '*[^0-9]*' AND length(number) <= 15) OR
      (substr(number,1,1) = '+' AND length(number) >= 4 AND substr(number,2) NOT GLOB '*[^0-9]*')
    )
  ),
  updated_by_user_id text NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  updated_at integer NOT NULL
);
