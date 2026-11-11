CREATE TABLE `observation_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider_response_id` text NOT NULL,
	`prompt_candidate_id` text NOT NULL,
	`section` text,
	`provider_experience` text NOT NULL,
	`analysis_version` text NOT NULL,
	`eligibility` text NOT NULL,
	`source_hash` text NOT NULL,
	`payload` text NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`supersedes_analysis_id` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`analysed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `observation_analyses_project_idx` ON `observation_analyses` (`project_id`);--> statement-breakpoint
CREATE INDEX `observation_analyses_response_idx` ON `observation_analyses` (`provider_response_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `observation_analyses_response_version_idx` ON `observation_analyses` (`provider_response_id`,`analysis_version`);