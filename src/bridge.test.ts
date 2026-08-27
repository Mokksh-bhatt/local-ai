import assert from "node:assert/strict";
import { test } from "node:test";
import { headlessSpec } from "./server/adapters.ts";
import { parseClaudeLine, runHeadless } from "./server/headless.ts";
import type { StreamEvent } from "./shared.ts";

function collect() {
  const events: StreamEvent[] = [];
  return {
    events,
    onEvent: (e: StreamEvent) => {
      events.push(e);
    },
  };
}

test("bridge: mocked Claude CLI streams a reply", async () => {
  const stdout =
    JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "pong" } } }) +
    "\n" +
    JSON.stringify({ type: "result", session_id: "mock-1" }) +
    "\n";
  const { events, onEvent } = collect();
  const r = await runHeadless({
    bin: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(stdout)})`],
    cwd: process.cwd(),
    parser: "claude",
    onEvent,
  });
  assert.equal(r.sessionId, "mock-1");
  assert.equal(
    events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e.type === "text_delta" ? e.text : ""))
      .join(""),
    "pong",
  );
});

test("bridge: argv for a one-shot prompt does not pass --model auto", () => {
  const spec = headlessSpec("copilot", { mode: "agent", permission: "auto" }, "hi");
  assert.equal(spec.args[0], "-p");
  assert.ok(!spec.args.includes("auto"));
});

test("bridge: CLI nonzero exit becomes an error event", async () => {
  const { events, onEvent } = collect();
  await runHeadless({
    bin: process.execPath,
    args: ["-e", "process.exit(2)"],
    cwd: process.cwd(),
    parser: "text",
    onEvent,
  });
  const err = events.find((e) => e.type === "error");
  assert.equal(err?.type, "error");
  assert.equal(err && err.type === "error" ? err.message : "", "exited 2");
});

test("bridge: CLI JSON error line is surfaced", () => {
  const events = parseClaudeLine(JSON.stringify({ type: "result", is_error: true, result: "auth failed" }));
  assert.equal(events[0]?.type, "error");
  assert.equal(events[0] && events[0].type === "error" ? events[0].message : "", "auth failed");
});

test("bridge: missing binary rejects", async () => {
  const { onEvent } = collect();
  await assert.rejects(
    () =>
      runHeadless({
        bin: "local-ai-cli-that-does-not-exist",
        args: [],
        cwd: process.cwd(),
        parser: "text",
        onEvent,
      }),
    /ENOENT|not found|spawn/i,
  );
});
