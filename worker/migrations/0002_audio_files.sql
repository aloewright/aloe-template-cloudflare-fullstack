CREATE TABLE IF NOT EXISTS audio_files (
	id text PRIMARY KEY NOT NULL,
	r2_key text NOT NULL,
	name text NOT NULL,
	content_type text NOT NULL,
	size integer NOT NULL,
	created_at text NOT NULL
);
