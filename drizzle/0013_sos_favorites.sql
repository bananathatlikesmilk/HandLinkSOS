ALTER TABLE trusted_connection ADD COLUMN requester_favorite integer NOT NULL DEFAULT 0 CONSTRAINT trusted_requester_favorite CHECK (requester_favorite IN (0, 1));
