ALTER TABLE `plex_link` ADD `owner_server_token_enc` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plex_link` ADD `client_identifier` text DEFAULT '' NOT NULL;