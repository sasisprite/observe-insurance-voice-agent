# Vapi Webhook Contract Evidence

This repair was validated against the official Vapi TypeScript server SDK types retrieved on 2026-08-13.

- [`ServerMessageToolCalls`](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/ServerMessageToolCalls.ts) documents both `toolCallList` and `toolWithToolCallList` for a `tool-calls` server message.
- [`ToolCallFunction`](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/ToolCallFunction.ts) defines a function call as a `name` plus JSON-string `arguments`.
- [`FunctionToolWithToolCall`](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/FunctionToolWithToolCall.ts) states that Vapi uses the first available tool/assistant server URL and expects a tool-call result response.
- [`ServerMessageResponseToolCalls`](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/ServerMessageResponseToolCalls.ts) defines the server response as a `results` array.
- [`ToolCallResult`](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/ToolCallResult.ts) requires `name` and `toolCallId`, and accepts stringified `result` or `error` content.

The active FastAPI route now returns `{ "results": [{ "toolCallId", "name", "result" }] }` for each Vapi tool call, parses both Vapi batch variants, and reuses the same result for a short YAML-configured duplicate-delivery window.
