// Re-export tenant config types and loaders for shared consumption
export interface TenantToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface TenantFAQ {
  question: string;
  answer: string;
}

export interface TenantConfig {
  tenantId: string;
  organizationName: string;
  agentName: string;
  systemPrompt: string;
  faqs: TenantFAQ[];
  authConfig: {
    requiredIdentifierLabel: string;
    requiredVerificationLabel: string;
    maxAttempts: number;
  };
  tools: TenantToolDefinition[];
}
