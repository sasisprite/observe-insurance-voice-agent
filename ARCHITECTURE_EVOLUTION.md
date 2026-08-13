# Architecture Evolution: Observe Insurance Voice Agent

## Recommendation

The current TypeScript/Vapi service should be hardened before introducing LangGraph or Langflow. The immediate lookup failure was not evidence that the whole architecture needed to be replaced. The backend normalization and lookup functions already authenticated the sample account correctly; the production issue was the boundary between spoken input, Vapi tool selection, tenant configuration, and runtime visibility.

The recommended evolution is an incremental graph boundary rather than a rewrite. Keep Vapi as the browser voice transport and keep the provider-neutral tool contract as the stable integration boundary. Introduce a graph runner behind that boundary once the workflow needs durable state, human-in-the-loop pauses, branching escalation, or multi-agent routing. LangGraph is a strong execution layer for this because its official documentation describes mixing deterministic steps with LLM-driven steps, persistence, human-in-the-loop control, streaming, and execution tracing [1]. Langflow is a strong authoring and configuration layer because it provides a Python-based visual editor, reusable components, agent tools, API access, and MCP support [3] [4].

## What was fixed before migration

The tenant YAML had been indented so that `auth_config`, `faqs`, and `tools` were siblings of the tenant rather than children of `observe-insurance`. This meant the frontend could receive a malformed tenant response and the Vapi assistant could be constructed without the expected tool definitions. The configuration is now correctly nested, the tool schemas are sourced from YAML, and `normalize_identifier` is a mandatory first tool for identifier input.

The runtime now has two layers of protection. Sarah is instructed to call `normalize_identifier` before `begin_tenant_lookup`, while the backend also normalizes deterministically inside every lookup function. Therefore, a model omission or variation in spoken phrasing does not make the lookup dependent on perfect LLM formatting. `CUST-10042`, `Customer ID CUST-10042`, `+15552345678`, and spoken digit forms are normalized before matching.

The generic backend adapter also persists a redacted tool trace. The trace records tenant, tool name, safe argument summaries, result status, duration, and timestamp without writing the full verification factor or identifier to the audit file. The browser session retains recent Vapi tool events so an interviewer can see normalization and lookup calls in the live voice room.

## Stable graph boundary

| Boundary | Current implementation | Future graph implementation |
|---|---|---|
| Voice transport | Vapi browser SDK | Vapi, LiveKit, or another transport without changing domain tools |
| Session state | TypeScript reducer with authentication stage | LangGraph state such as `identifier`, `normalizedIdentifier`, `authAttempts`, `claim`, `escalated`, and `messages` |
| Deterministic normalization | `normalize_identifier` tool plus backend normalization | A deterministic graph node before any lookup edge |
| Customer lookup | `begin_tenant_lookup` and `verify_tenant_record` | Connector node or tool with the same input/output schema |
| FAQs | Tenant YAML FAQ entries | Knowledge-base or retrieval node selected by tenant configuration |
| Escalation | Prompt instruction and escalation flag | Conditional graph edge to a human-handoff node or queue connector |
| Post-call logging | `log_interaction` tool and local JSON persistence | Durable audit connector with retry and idempotency key |
| Observability | Redacted local tool-call trace and browser tool activity | LangSmith/Langflow logs plus the existing provider-neutral audit events |

## Proposed graph state

```text
threadId
  tenantId
  callId
  phase: greeting | identifier | verification | authenticated | faq | escalation | completed
  identifierRaw
  normalizedIdentifier
  identifierType
  authAttempts
  customerSummary
  claimSummary
  callerSentiment
  escalated
  messages
  toolEvents
```

The graph should make the safety-critical paths explicit. The identifier node accepts speech-derived text, the normalization node produces a canonical value, and only then can a conditional edge call the customer lookup connector. A `not_found` result returns to the identifier node; a failed verification increments `authAttempts`; the maximum-attempt edge routes to escalation; and a successful verification edge enables claim lookup and FAQ handling. The finalization node writes the post-call record exactly once using `callId` as an idempotency key.

## Langflow admin-console model

Langflow should not be embedded directly into the public caller page. It should run as a protected authoring service for solution architects. The admin console would manage a versioned flow definition, tenant prompt, allowed connectors, tool schemas, FAQ source, escalation policy, and validation status. The public voice service would load only a published flow version, not arbitrary draft components.

The connector model should expose typed capabilities rather than raw credentials. For example, a `CustomerLookupConnector` can declare `lookupByIdentifier` and `verifyRecord`, while a `PostCallAuditConnector` can declare `appendInteraction`. Credential references remain server-side, and each published flow is validated against an allowlist of tools, required fields, data-retention rules, and emergency/escalation behavior before activation.

## Why not migrate immediately

A direct migration now would add Python deployment, graph persistence, flow versioning, connector authentication, and another runtime while the current issue is still being isolated. That would make it harder to demonstrate whether normalization, tool schemas, Vapi timing, or tenant configuration is responsible for a failed call. The safer interview narrative is: first stabilize the contracts and observability in TypeScript; then move orchestration behind the same contracts when branching and persistence justify it.

The first graph-backed milestone should be a shadow mode. The existing TypeScript path remains authoritative while the graph executes the same deterministic normalization and lookup decisions for test calls. Once the graph produces equivalent results for happy path, authentication failure, customer not found, representative escalation, FAQ, emergency, and post-call logging scenarios, routing can be switched by tenant configuration or a feature flag.

## References

[1]: https://docs.langchain.com/oss/python/langgraph/overview "LangGraph overview — LangChain documentation"
[2]: https://docs.langchain.com/oss/python/langgraph/persistence "Persistence — LangGraph documentation"
[3]: https://docs.langflow.org/ "What is Langflow? — Langflow documentation"
[4]: https://docs.langflow.org/concepts-overview "Use the visual editor — Langflow documentation"
