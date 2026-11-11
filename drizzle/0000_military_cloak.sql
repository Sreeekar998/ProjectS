CREATE TABLE `aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aliases_entity_idx` ON `aliases` (`entity_id`);--> statement-breakpoint
CREATE TABLE `business_profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`crawl_run_id` text,
	`profile` text NOT NULL,
	`field_provenance` text NOT NULL,
	`confirmed_at` integer,
	`confirmed_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `business_profile_versions_project_idx` ON `business_profile_versions` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `business_profile_versions_project_version_idx` ON `business_profile_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_response_id` text NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`matched_entity_id` text,
	`is_owned_domain` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `citations_response_idx` ON `citations` (`provider_response_id`);--> statement-breakpoint
CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`prompt_set_id` text NOT NULL,
	`provider_experiences` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collection_runs_project_idx` ON `collection_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `crawl_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`crawl_run_id` text NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`page_type` text,
	`http_status` integer,
	`fetch_method` text DEFAULT 'http' NOT NULL,
	`content_hash` text,
	`score` integer,
	`selected_reason` text,
	`title` text,
	`meta_description` text,
	`canonical_url` text,
	`headings` text,
	`json_ld` text,
	`structured_signals` text,
	`fetched_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `crawl_pages_run_idx` ON `crawl_pages` (`crawl_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_pages_run_url_idx` ON `crawl_pages` (`crawl_run_id`,`normalized_url`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`robots_allowed` integer,
	`robots_checked_at` integer,
	`sitemap_urls` text,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`selected_count` integer DEFAULT 0 NOT NULL,
	`block_reason` text,
	`used_playwright_fallback` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_project_idx` ON `crawl_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`competitor_type` text,
	`canonical_name` text NOT NULL,
	`domains` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`confidence` integer,
	`reason` text,
	`geography_relevance` text,
	`evidence_ids` text,
	`source` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entities_project_idx` ON `entities` (`project_id`);--> statement-breakpoint
CREATE INDEX `entities_kind_idx` ON `entities` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_project_seq_idx` ON `events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_project_seq_unique` ON `events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `evidence_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`crawl_page_id` text NOT NULL,
	`project_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`char_offset_start` integer NOT NULL,
	`char_offset_end` integer NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_chunks_page_idx` ON `evidence_chunks` (`crawl_page_id`);--> statement-breakpoint
CREATE INDEX `evidence_chunks_project_idx` ON `evidence_chunks` (`project_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`project_id` text,
	`payload` text NOT NULL,
	`lane` text DEFAULT 'interactive' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`run_after` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`level` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`country_code` text,
	`evidence_ids` text,
	`is_primary` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `locations_project_idx` ON `locations` (`project_id`);--> statement-breakpoint
CREATE TABLE `manual_capture_events` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_run_id` text NOT NULL,
	`operator` text NOT NULL,
	`action` text NOT NULL,
	`at` integer NOT NULL,
	`checklist` text
);
--> statement-breakpoint
CREATE INDEX `manual_capture_events_run_idx` ON `manual_capture_events` (`prompt_run_id`);--> statement-breakpoint
CREATE TABLE `mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_response_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`alias_matched` text,
	`char_start` integer,
	`char_end` integer,
	`is_recommendation` integer DEFAULT false NOT NULL,
	`rank_position` integer,
	`confidence` integer NOT NULL,
	`parser_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mentions_response_idx` ON `mentions` (`provider_response_id`);--> statement-breakpoint
CREATE INDEX `mentions_entity_idx` ON `mentions` (`entity_id`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`collection_run_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`filter_key` text NOT NULL,
	`numerator` integer NOT NULL,
	`denominator` integer NOT NULL,
	`value` integer,
	`contributing_observation_ids` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`parser_version` text NOT NULL,
	`alias_set_version` text NOT NULL,
	`computed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_snapshots_project_idx` ON `metric_snapshots` (`project_id`);--> statement-breakpoint
CREATE INDEX `metric_snapshots_run_metric_idx` ON `metric_snapshots` (`collection_run_id`,`metric_key`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`registrable_domain` text NOT NULL,
	`market_scope` text NOT NULL,
	`language` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`capability_gates` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_set_id` text NOT NULL,
	`text` text NOT NULL,
	`edited_text` text,
	`cohort` text NOT NULL,
	`intent` text NOT NULL,
	`journey_stage` text NOT NULL,
	`topic_id` text,
	`persona` text,
	`use_case_constraint` text,
	`geography_scope` text DEFAULT 'none' NOT NULL,
	`geography_text` text,
	`location_id` text,
	`language` text NOT NULL,
	`brand_policy` text NOT NULL,
	`coverage_cell_key` text NOT NULL,
	`evidence_basis` text,
	`quality_score` integer,
	`quality_breakdown` text,
	`lifecycle_state` text NOT NULL,
	`rejected_reason` text,
	`duplicate_of_id` text,
	`selection_reason` text,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_candidates_set_idx` ON `prompt_candidates` (`prompt_set_id`);--> statement-breakpoint
CREATE INDEX `prompt_candidates_state_idx` ON `prompt_candidates` (`prompt_set_id`,`lifecycle_state`);--> statement-breakpoint
CREATE TABLE `prompt_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_run_id` text NOT NULL,
	`prompt_candidate_id` text NOT NULL,
	`provider_experience` text NOT NULL,
	`sample_index` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`attempt_history` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_runs_collection_idx` ON `prompt_runs` (`collection_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_runs_idempotency_idx` ON `prompt_runs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `prompt_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`business_profile_version_id` text NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`coverage_policy` text NOT NULL,
	`generation_stats` text,
	`approved_at` integer,
	`frozen_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_sets_project_idx` ON `prompt_sets` (`project_id`);--> statement-breakpoint
CREATE TABLE `provider_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_run_id` text NOT NULL,
	`provider_experience` text NOT NULL,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`visible_model_mode` text,
	`search_state` text,
	`account_tier` text,
	`locale` text,
	`observer_region` text,
	`response_text` text NOT NULL,
	`source_urls` text NOT NULL,
	`raw_hash` text NOT NULL,
	`latency_ms` integer,
	`observed_at` integer NOT NULL,
	`adapter_version` text NOT NULL,
	`parser_version` text,
	`policy_version` text NOT NULL,
	`is_fixture` integer DEFAULT false NOT NULL,
	`fixture_label` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_responses_prompt_run_id_unique` ON `provider_responses` (`prompt_run_id`);--> statement-breakpoint
CREATE INDEX `provider_responses_provider_idx` ON `provider_responses` (`provider_experience`);--> statement-breakpoint
CREATE TABLE `route_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_experience` text NOT NULL,
	`enabled` text NOT NULL,
	`permitted_operations` text NOT NULL,
	`requires_card` integer DEFAULT false NOT NULL,
	`retention_days` integer,
	`official_source_url` text,
	`last_checked_at` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_policies_provider_experience_unique` ON `route_policies` (`provider_experience`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`business_profile_version_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`source` text DEFAULT 'system' NOT NULL,
	`evidence_ids` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `topics_project_idx` ON `topics` (`project_id`);