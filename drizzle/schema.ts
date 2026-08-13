import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const tenants = mysqlTable("tenants", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 96 }).notNull().unique(),
  organizationName: varchar("organizationName", { length: 255 }).notNull(),
  deploymentKey: varchar("deploymentKey", { length: 128 }).notNull().unique(),
  status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const tenantAgentConfigs = mysqlTable("tenantAgentConfigs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  version: int("version").default(1).notNull(),
  agentName: varchar("agentName", { length: 128 }).notNull(),
  systemPrompt: text("systemPrompt").notNull(),
  firstMessage: text("firstMessage").notNull(),
  settingsJson: text("settingsJson").notNull(),
  toolsJson: text("toolsJson").notNull(),
  published: int("published").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantVersion: uniqueIndex("tenant_agent_config_version").on(table.tenantId, table.version),
  tenantPublished: index("tenant_agent_config_published").on(table.tenantId, table.published),
}));

export const voiceCustomers = mysqlTable("voiceCustomers", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  customerId: varchar("customerId", { length: 128 }).notNull(),
  phoneNumber: varchar("phoneNumber", { length: 64 }).notNull(),
  fullName: varchar("fullName", { length: 255 }).notNull(),
  verificationFactor: varchar("verificationFactor", { length: 32 }).notNull(),
  claimId: varchar("claimId", { length: 128 }),
  metadataJson: text("metadataJson"),
}, (table) => ({
  tenantCustomer: uniqueIndex("voice_customer_tenant_customer").on(table.tenantId, table.customerId),
  tenantPhone: index("voice_customer_tenant_phone").on(table.tenantId, table.phoneNumber),
}));

export const voiceClaims = mysqlTable("voiceClaims", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  claimId: varchar("claimId", { length: 128 }).notNull(),
  customerId: varchar("customerId", { length: 128 }).notNull(),
  policyNumber: varchar("policyNumber", { length: 128 }),
  status: varchar("status", { length: 96 }).notNull(),
  stage: varchar("stage", { length: 96 }),
  requiredDocumentsJson: text("requiredDocumentsJson"),
  adjusterName: varchar("adjusterName", { length: 255 }),
}, (table) => ({
  tenantClaim: uniqueIndex("voice_claim_tenant_claim").on(table.tenantId, table.claimId),
}));

export const voiceCalls = mysqlTable("voiceCalls", {
  id: int("id").autoincrement().primaryKey(),
  callId: varchar("callId", { length: 160 }).notNull().unique(),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  deploymentKey: varchar("deploymentKey", { length: 128 }),
  status: varchar("status", { length: 64 }).notNull(),
  outcome: varchar("outcome", { length: 96 }),
  terminationReason: varchar("terminationReason", { length: 96 }),
  metadataJson: text("metadataJson"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantStatus: index("voice_calls_tenant_status").on(table.tenantId, table.status),
  tenantStarted: index("voice_calls_tenant_started").on(table.tenantId, table.startedAt),
}));

export const voiceCallEvents = mysqlTable("voiceCallEvents", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 160 }).notNull().unique(),
  callId: varchar("callId", { length: 160 }),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  eventType: varchar("eventType", { length: 96 }).notNull(),
  source: varchar("source", { length: 64 }).notNull(),
  sequence: int("sequence"),
  payloadJson: text("payloadJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  callSequence: index("voice_call_events_call_sequence").on(table.callId, table.sequence),
  tenantEvent: index("voice_call_events_tenant_event").on(table.tenantId, table.eventType),
}));

export const handoffCases = mysqlTable("handoffCases", {
  id: int("id").autoincrement().primaryKey(),
  caseId: varchar("caseId", { length: 160 }).notNull().unique(),
  callId: varchar("callId", { length: 160 }).notNull(),
  tenantId: varchar("tenantId", { length: 96 }).notNull(),
  status: varchar("status", { length: 64 }).default("open").notNull(),
  priority: varchar("priority", { length: 32 }).default("normal").notNull(),
  reason: varchar("reason", { length: 160 }).notNull(),
  summary: text("summary").notNull(),
  payloadJson: text("payloadJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  tenantQueue: index("handoff_cases_tenant_queue").on(table.tenantId, table.status, table.priority),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type TenantAgentConfig = typeof tenantAgentConfigs.$inferSelect;
export type VoiceCustomer = typeof voiceCustomers.$inferSelect;
export type VoiceClaim = typeof voiceClaims.$inferSelect;
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceCallEvent = typeof voiceCallEvents.$inferSelect;
export type HandoffCase = typeof handoffCases.$inferSelect;
