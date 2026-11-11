ALTER TABLE `collection_runs` ADD `samples_per_prompt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_runs` ADD `baseline_label` text DEFAULT 'directional' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `inline_citation_urls` text;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `answer_capture_state` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `sources_capture_state` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `session_profile` text;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `intended_market` text;--> statement-breakpoint
ALTER TABLE `provider_responses` ADD `observer_region_source` text DEFAULT 'unknown' NOT NULL;