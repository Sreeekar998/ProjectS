CREATE TABLE `measurement_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`collection_run_id` text NOT NULL,
	`prompt_set_id` text NOT NULL,
	`prompt_set_version` integer,
	`competitive_set_version_id` text,
	`analysis_versions` text NOT NULL,
	`metric_policy_version` text NOT NULL,
	`provider_experiences` text NOT NULL,
	`engines` text NOT NULL,
	`samples_per_prompt` integer DEFAULT 1 NOT NULL,
	`fingerprint` text NOT NULL,
	`coverage` text NOT NULL,
	`result` text NOT NULL,
	`supersedes_snapshot_id` text,
	`computed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `measurement_snapshots_project_idx` ON `measurement_snapshots` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `measurement_snapshots_run_versions_idx` ON `measurement_snapshots` (`collection_run_id`,`analysis_versions`,`metric_policy_version`);--> statement-breakpoint
ALTER TABLE `collection_runs` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `collection_runs` ADD `finalised_by` text;