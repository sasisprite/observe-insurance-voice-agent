# Observe Insurance Voice Agent - Adversarial Stress Test Matrix

This matrix outlines the test scenarios used to stress-test Sarah, the Observe Insurance AI Claims Support Agent, covering normal flows, messy speech, interruptions, self-corrections, authentication failures, customer-not-found paths, representative escalations, unsupported questions, and emergency situations.

| Scenario ID | Category | Input / User Utterance | Expected Agent Behavior | Tool / Audit Logging Expected |
|---|---|---|---|---|
| **SM-01** | Happy Path (Phone) | "+1 (555) 234-5678" | Greet caller, accept phone number, normalize, look up tenant, ask for verification (DOB). | `normalize_identifier`, `begin_tenant_lookup` (status: `verification_required`) |
| **SM-02** | Happy Path (Customer ID) | "CUST-10042" | Accept customer ID, normalize, look up tenant, ask for verification (DOB). | `normalize_identifier`, `begin_tenant_lookup` (status: `verification_required`) |
| **SM-03** | Messy Speech / Spelled Digits | "plus one, triple five, two three four, five six seven eight" | Interpret spoken digits and normalize to canonical wire format `+1 (555) 234-5678`. | `normalize_identifier`, `begin_tenant_lookup` |
| **SM-04** | Messy Customer ID | "my customer ID is c u s t hyphen one zero zero four two" | Strip spaces and normalize to `cust-10042`. | `normalize_identifier`, `begin_tenant_lookup` |
| **SM-05** | Self-Correction Mid-Utterance | "My phone number is 555... wait no, 555-987-6543" | Wait for pause, ignore aborted prefix, normalize final stated identifier. | `normalize_identifier`, `begin_tenant_lookup` |
| **SM-06** | Auth Failure (Invalid DOB) | DOB: "1990-01-01" (does not match stored `1988-11-20`) | Inform caller of mismatch, prompt for re-verification (attempt 1/2). | `verify_tenant_record` (status: `auth_failure`) |
| **SM-07** | Auth Locked Out (Max Attempts) | DOB: "1990-01-01" (second failure) | Offer gentle human escalation or transfer. | `verify_tenant_record` (status: `auth_failure`, max exceeded) |
| **SM-08** | Customer Not Found | Identifier: "+1 (555) 999-9999" | Inform caller account was not matched, ask to re-state identifier. | `begin_tenant_lookup` (status: `not_found`) |
| **SM-09** | Representative Escalation | "I want to speak to a human agent right now." | Acknowledge with calm, reassuring tone, confirm post-call logging, provide callback timeline (e.g., 2 hours). | Post-call audit record created with `escalation: true` |
| **SM-10** | Unsupported Question | "Can you tell me the weather in Paris?" | Politely state scope (claims and policy support) and redirect back to claim status or FAQs. | None (conversational redirection) |
| **SM-11** | Emergency Situation | "I've been in a severe crash and need immediate help!" | Urge caller to contact local emergency services immediately (911). | Emergency flag / safety logging |
| **SM-12** | FAQ Support | "What are your office hours and mailing address?" | Provide clear, concise FAQ response without requiring lookup. | None |
