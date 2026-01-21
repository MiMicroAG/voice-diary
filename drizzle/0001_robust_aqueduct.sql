CREATE TABLE `recordings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`audioFileKey` varchar(512) NOT NULL,
	`audioUrl` text NOT NULL,
	`duration` int,
	`status` enum('uploading','processing','completed','failed') NOT NULL DEFAULT 'uploading',
	`transcribedText` text,
	`notionPageId` varchar(128),
	`notionPageUrl` text,
	`tags` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recordings_id` PRIMARY KEY(`id`)
);
