import assert from "node:assert/strict";
import { buildPrompt } from "./server/context.ts";
import { headlessSpec } from "./server/adapters.ts";
import { parseClaudeControl, parseClaudeLine, parseCodexLine, parseTextChunk } from "./server/headless.ts";

const hi = parseClaudeLine(
  JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Hi" } } }),
);
assert.equal(hi[0]?.type, "text_delta");
assert.equal(hi[0] && hi[0].type === "text_delta" ? hi[0].text : "", "Hi");

const done = parseClaudeLine(JSON.stringify({ type: "result", session_id: "s1", total_cost_usd: 0.02 }));
assert.equal(done[0]?.type, "done");
assert.equal(done[0] && done[0].type === "done" ? done[0].sessionId : "", "s1");

const tool = parseClaudeLine(
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "1", name: "Read", input: { path: "a.ts" } }] },
  }),
);
assert.equal(tool[0]?.type, "tool_start");
assert.equal(tool[0] && tool[0].type === "tool_start" ? tool[0].name : "", "Read");

const err = parseClaudeLine(JSON.stringify({ type: "result", is_error: true, result: "nope" }));
assert.equal(err[0]?.type, "error");

const junk = parseClaudeLine("not-json");
assert.equal(junk.length, 0);

const codex = parseCodexLine(
  JSON.stringify({ type: "item.completed", item: { id: "i", type: "agent_message", text: "Done" } }),
);
assert.equal(codex.some((e) => e.type === "text_delta" && e.text === "Done"), true);

const bash = parseCodexLine(
  JSON.stringify({ type: "item.started", item: { id: "c", type: "command_execution", command: "git status" } }),
);
assert.equal(bash[0]?.type, "tool_start");

const txt = parseTextChunk("abc");
assert.equal(txt[0]?.type, "text_delta");
assert.equal(txt[0] && txt[0].type === "text_delta" ? txt[0].text : "", "abc");

const think = parseClaudeLine(
  JSON.stringify({ type: "stream_event", event: { delta: { type: "thinking_delta", thinking: "hmm" } } }),
);
assert.equal(think[0]?.type, "thought");
assert.equal(think[0] && think[0].type === "thought" ? think[0].text : "", "hmm");

const ctl = parseClaudeControl(
  JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { cmd: "ls" } } }),
);
assert.equal(ctl?.requestId, "r1");
assert.equal(ctl?.title.includes("Bash"), true);

const copilotSpec = headlessSpec("copilot", { mode: "agent", permission: "auto" }, "hi");
assert.equal(copilotSpec.args[0], "-p");
assert.equal(copilotSpec.args[1], "hi");
assert.ok(!copilotSpec.args.includes("auto"));

const claudeAsk = headlessSpec("claude", { mode: "agent", permission: "ask" }, "hello-prompt");
assert.equal(claudeAsk.keepStdin, true);
assert.equal(claudeAsk.args[0], "--print");
assert.ok(!!claudeAsk.stdin && claudeAsk.stdin.includes("hello-prompt"));
assert.ok(!claudeAsk.args.includes("hello-prompt"));
assert.ok(claudeAsk.args.includes("--input-format"));

const claudeModel = headlessSpec("claude", { mode: "agent", permission: "auto", model: "opus" }, "x");
assert.ok(claudeModel.args.includes("--model"));
assert.ok(claudeModel.args.includes("opus"));
assert.equal(claudeModel.keepStdin, false);

const liveThink = parseClaudeLine(
  JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "live" } }),
);
assert.equal(liveThink[0]?.type, "thought");
assert.equal(liveThink[0] && liveThink[0].type === "thought" ? liveThink[0].text : "", "live");

const act = parseClaudeLine(JSON.stringify({ type: "system", subtype: "status", status: "requesting" }));
assert.equal(act[0]?.type, "activity");

const packed = buildPrompt({
  memory: "use bun",
  skills: [],
  history: [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
  ],
  user: "now what",
});
assert.ok(packed.includes("use bun"));
assert.ok(packed.includes("User: hi"));
assert.ok(packed.includes("Assistant: hello"));
assert.ok(packed.endsWith("now what"));

console.log("ok");
