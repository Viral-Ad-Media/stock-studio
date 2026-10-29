import assert from "node:assert/strict";
import { test } from "node:test";
import { extractStructuredOrFail, PermanentJobError } from "../lib/engine/anthropic";

const schema = { type: "object", properties: { thesis: { type: "string" } }, required: ["thesis"] };
const opts = () => ({ researchedText: "research", instructions: "extract", toolName: "record", schema, deadline: Date.now() + 120_000 });

// One test: the SDK client is cached and keeps the fetch it was created with.
test("a bad extraction is retried once, never by re-running the research", async (t) => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-secret";
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  let replies: (Record<string, unknown> | number)[] = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const r = replies[Math.min(calls++, replies.length - 1)];
    if (typeof r === "number") return Response.json({ type: "error", error: { type: "api_error", message: "boom" } }, { status: r });
    return Response.json({
      id: `msg_${calls}`, type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: `toolu_${calls}`, name: "record", input: r }],
      stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  // Missing field, then good: the second extraction is used.
  replies = [{ thesis: "" }, { thesis: "Holds up." }];
  calls = 0;
  assert.deepEqual(await extractStructuredOrFail(opts()), { thesis: "Holds up." });
  assert.equal(calls, 2);

  // Bad twice: a permanent failure, so the worker refunds instead of retrying the research.
  replies = [{ thesis: "" }];
  calls = 0;
  await assert.rejects(extractStructuredOrFail(opts()), PermanentJobError);
  assert.equal(calls, 2);

  // API errors pass straight through to the worker's normal handling.
  replies = [400];
  calls = 0;
  await assert.rejects(extractStructuredOrFail(opts()), (err) => !(err instanceof PermanentJobError));
  assert.equal(calls, 1);
});
