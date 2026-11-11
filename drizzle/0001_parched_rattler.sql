CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`crawl_page_id` text,
	`url` text NOT NULL,
	`canonical_url` text,
	`page_type` text NOT NULL,
	`source_type` text NOT NULL,
	`text` text NOT NULL,
	`field_hint` text,
	`data` text,
	`extracted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_items_run_idx` ON `evidence_items` (`run_id`);--> statement-breakpoint
CREATE INDEX `evidence_items_project_idx` ON `evidence_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `evidence_items_hint_idx` ON `evidence_items` (`run_id`,`field_hint`);--> statement-breakpoint
ALTER TABLE `business_profile_versions` ADD `status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `business_profile_versions` ADD `user_edited_fields` text;--> statement-breakpoint
ALTER TABLE `business_profile_versions` ADD `synthesis_mode` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `slot_key` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `family_key` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `score_breakdown` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `is_selected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `schema_types` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `hreflang` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `breadcrumb` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `html_lang` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `og_site_name` text;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `word_count` integer;--> statement-breakpoint
ALTER TABLE `crawl_pages` ADD `fetch_ms` integer;--> statement-breakpoint
ALTER TABLE `crawl_runs` ADD `metrics` text;