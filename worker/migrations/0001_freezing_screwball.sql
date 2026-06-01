CREATE TABLE `cf_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_hash` text,
	`stream_code` text,
	`token_cipher` text NOT NULL,
	`token_iv` text NOT NULL,
	`flexible_variants_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
