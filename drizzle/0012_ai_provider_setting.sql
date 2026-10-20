CREATE TABLE `ai_provider_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`revision` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_provider_singleton" CHECK("ai_provider_setting"."id" = 'summary'),
	CONSTRAINT "ai_provider_allowed" CHECK("ai_provider_setting"."provider" in ('ollama', 'gemini'))
);
