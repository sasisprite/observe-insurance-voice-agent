CREATE TABLE `handoffCases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` varchar(160) NOT NULL,
	`callId` varchar(160) NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`status` varchar(64) NOT NULL DEFAULT 'open',
	`priority` varchar(32) NOT NULL DEFAULT 'normal',
	`reason` varchar(160) NOT NULL,
	`summary` text NOT NULL,
	`payloadJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `handoffCases_id` PRIMARY KEY(`id`),
	CONSTRAINT `handoffCases_caseId_unique` UNIQUE(`caseId`)
);
--> statement-breakpoint
CREATE TABLE `tenantAgentConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`agentName` varchar(128) NOT NULL,
	`systemPrompt` text NOT NULL,
	`firstMessage` text NOT NULL,
	`settingsJson` text NOT NULL,
	`toolsJson` text NOT NULL,
	`published` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenantAgentConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_agent_config_version` UNIQUE(`tenantId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`organizationName` varchar(255) NOT NULL,
	`deploymentKey` varchar(128) NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_tenantId_unique` UNIQUE(`tenantId`),
	CONSTRAINT `tenants_deploymentKey_unique` UNIQUE(`deploymentKey`)
);
--> statement-breakpoint
CREATE TABLE `voiceCallEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(160) NOT NULL,
	`callId` varchar(160),
	`tenantId` varchar(96) NOT NULL,
	`eventType` varchar(96) NOT NULL,
	`source` varchar(64) NOT NULL,
	`sequence` int,
	`payloadJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voiceCallEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `voiceCallEvents_eventId_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `voiceCalls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callId` varchar(160) NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`deploymentKey` varchar(128),
	`status` varchar(64) NOT NULL,
	`outcome` varchar(96),
	`terminationReason` varchar(96),
	`metadataJson` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `voiceCalls_id` PRIMARY KEY(`id`),
	CONSTRAINT `voiceCalls_callId_unique` UNIQUE(`callId`)
);
--> statement-breakpoint
CREATE TABLE `voiceClaims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`claimId` varchar(128) NOT NULL,
	`customerId` varchar(128) NOT NULL,
	`policyNumber` varchar(128),
	`status` varchar(96) NOT NULL,
	`stage` varchar(96),
	`requiredDocumentsJson` text,
	`adjusterName` varchar(255),
	CONSTRAINT `voiceClaims_id` PRIMARY KEY(`id`),
	CONSTRAINT `voice_claim_tenant_claim` UNIQUE(`tenantId`,`claimId`)
);
--> statement-breakpoint
CREATE TABLE `voiceCustomers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(96) NOT NULL,
	`customerId` varchar(128) NOT NULL,
	`phoneNumber` varchar(64) NOT NULL,
	`fullName` varchar(255) NOT NULL,
	`verificationFactor` varchar(32) NOT NULL,
	`claimId` varchar(128),
	`metadataJson` text,
	CONSTRAINT `voiceCustomers_id` PRIMARY KEY(`id`),
	CONSTRAINT `voice_customer_tenant_customer` UNIQUE(`tenantId`,`customerId`)
);
--> statement-breakpoint
CREATE INDEX `handoff_cases_tenant_queue` ON `handoffCases` (`tenantId`,`status`,`priority`);--> statement-breakpoint
CREATE INDEX `tenant_agent_config_published` ON `tenantAgentConfigs` (`tenantId`,`published`);--> statement-breakpoint
CREATE INDEX `voice_call_events_call_sequence` ON `voiceCallEvents` (`callId`,`sequence`);--> statement-breakpoint
CREATE INDEX `voice_call_events_tenant_event` ON `voiceCallEvents` (`tenantId`,`eventType`);--> statement-breakpoint
CREATE INDEX `voice_calls_tenant_status` ON `voiceCalls` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `voice_calls_tenant_started` ON `voiceCalls` (`tenantId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `voice_customer_tenant_phone` ON `voiceCustomers` (`tenantId`,`phoneNumber`);