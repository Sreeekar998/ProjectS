CREATE TABLE `competitive_set_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`business_profile_version_id` text NOT NULL,
	`topic_snapshot` text NOT NULL,
	`competitor_snapshot` text NOT NULL,
	`discovery_policy_version` text NOT NULL,
	`frozen_hash` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `competitive_set_versions_project_idx` ON `competitive_set_versions` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitive_set_versions_project_version_idx` ON `competitive_set_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `competitor_discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`business_profile_version_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`source_stats` text,
	`metrics` text,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `competitor_discovery_runs_project_idx` ON `competitor_discovery_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `prompt_context_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`business_profile_version_id` text NOT NULL,
	`competitive_set_version_id` text NOT NULL,
	`context` text NOT NULL,
	`frozen_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_context_snapshots_project_idx` ON `prompt_context_snapshots` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `entities` ADD `normalized_name` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `canonical_domain` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `entity_type` text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `parent_entity_id` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `relationship` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `discovery_status` text DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `source_contributions` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `matched_dimensions` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `score_breakdown` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `verification_status` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `verification_summary` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `rejection_reason` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `candidate_profile` text;--> statement-breakpoint
CREATE INDEX `entities_project_normalized_idx` ON `entities` (`project_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `entities_project_domain_idx` ON `entities` (`project_id`,`canonical_domain`);--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `section` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `evaluation_criterion` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `competitor_entity_id` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `sentiment_theme` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `generation_source` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `context_basis` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `coverage_gain` integer;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `diversity_gain` integer;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `selection_score` integer;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `validation_result` text;--> statement-breakpoint
ALTER TABLE `prompt_candidates` ADD `semantic_cluster_id` text;--> statement-breakpoint
ALTER TABLE `prompt_sets` ADD `competitive_set_version_id` text;--> statement-breakpoint
ALTER TABLE `prompt_sets` ADD `prompt_context_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `prompt_sets` ADD `selection_policy_version` text;--> statement-breakpoint
ALTER TABLE `prompt_sets` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `topics` ADD `discovery_concept` text;
--> statement-breakpoint
UPDATE `topics` SET `discovery_concept` = `name` WHERE `discovery_concept` IS NULL;
--> statement-breakpoint
UPDATE `entities`
SET `normalized_name` = lower(trim(`canonical_name`)),
    `source` = CASE WHEN `source` = 'user' THEN 'user_manual' ELSE `source` END,
    `source_contributions` = CASE WHEN `source` = 'user' THEN '["user_manual"]' ELSE json_array(`source`) END,
    `discovery_status` = CASE WHEN `status` = 'confirmed' THEN 'confirmed' WHEN `status` = 'removed' THEN 'rejected' ELSE 'suggested' END
WHERE `normalized_name` IS NULL;
