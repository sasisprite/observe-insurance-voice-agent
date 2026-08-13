const baseUrl = process.env.VOICE_AGENT_API_URL || "http://127.0.0.1:8000";

const cases = [
  {
    id: "SM-03",
    name: "Messy spoken phone",
    payload: {
      tenantId: "observe-insurance",
      toolName: "normalize_identifier",
      arguments: { rawIdentifier: "plus one, triple five, two three four, five six seven eight" },
    },
  },
  {
    id: "SM-04",
    name: "Messy customer ID",
    payload: {
      tenantId: "observe-insurance",
      toolName: "normalize_identifier",
      arguments: { rawIdentifier: "my customer ID is c u s t hyphen one zero zero four two" },
    },
  },
  {
    id: "SM-01",
    name: "Canonical phone lookup",
    payload: {
      tenantId: "observe-insurance",
      toolName: "begin_tenant_lookup",
      arguments: { identifier: "+15552345678" },
    },
  },
  {
    id: "SM-02",
    name: "Canonical customer ID lookup",
    payload: {
      tenantId: "observe-insurance",
      toolName: "begin_tenant_lookup",
      arguments: { identifier: "CUST-10042" },
    },
  },
  {
    id: "SM-08",
    name: "Customer not found",
    payload: {
      tenantId: "observe-insurance",
      toolName: "begin_tenant_lookup",
      arguments: { identifier: "+15559999999" },
    },
  },
  {
    id: "SM-06",
    name: "Authentication failure",
    payload: {
      tenantId: "observe-insurance",
      toolName: "verify_tenant_record",
      arguments: { customerId: "CUST-10042", verificationValue: "January 1, 1990" },
    },
  },
  {
    id: "SM-07",
    name: "Authentication success and claim retrieval",
    payload: {
      tenantId: "observe-insurance",
      toolName: "verify_tenant_record",
      arguments: { customerId: "CUST-10042", verificationValue: "1988-11-20" },
    },
  },
  {
    id: "SM-09",
    name: "Escalation interaction log",
    payload: {
      tenantId: "observe-insurance",
      toolName: "log_interaction",
      arguments: {
        callerName: "Test Caller",
        callSummary: "Caller requested a human representative.",
        sentiment: "concerned",
        escalated: true,
        timestamp: "2026-08-13T06:45:00.000Z",
      },
    },
  },
  {
    id: "SM-11",
    name: "Emergency safety event",
    payload: {
      type: "status-update",
      callId: "stress-test-emergency-001",
      message: { type: "status-update", timestamp: "2026-08-13T06:45:01.000Z" },
    },
    endpoint: "/api/voice-agent/events",
  },
  {
    id: "SM-12",
    name: "Unknown tool rejection",
    payload: {
      tenantId: "observe-insurance",
      toolName: "unsupported_tool",
      arguments: {},
    },
    expectStatus: 400,
  },
  {
    id: "SM-13",
    name: "Vapi batch customer ID lookup handoff",
    payload: {
      message: {
        type: "tool-calls",
        call: { id: "stress-vapi-batch-cust-10042" },
        assistant: { metadata: { tenantId: "observe-insurance" } },
        toolCallList: [{
          id: "tool-stress-cust-10042",
          type: "function",
          function: { name: "begin_tenant_lookup", arguments: JSON.stringify({ identifier: "cust-10042" }) },
        }],
      },
    },
  },
];

const results = [];
for (const scenario of cases) {
  const endpoint = scenario.endpoint || "/api/voice-agent/tools";
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario.payload),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  results.push({
    id: scenario.id,
    name: scenario.name,
    status: response.status,
    expectedStatus: scenario.expectStatus || 200,
    pass: response.status === (scenario.expectStatus || 200),
    body,
  });
}

console.log(JSON.stringify({ baseUrl, results }, null, 2));
if (results.some((item) => !item.pass)) process.exitCode = 1;
