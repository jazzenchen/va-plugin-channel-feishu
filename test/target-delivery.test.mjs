import assert from "node:assert/strict";
import test from "node:test";

import { AgentStreamHandler } from "../dist/agent-stream.js";
import { FeishuClient } from "../dist/lark-client.js";

const target = {
  channelInstanceId: "feishu-primary",
  actorId: "feishu-bot",
  chatId: "oc_group",
  topicId: "omt_thread",
  replyTo: "om_inbound",
};

test("Feishu renderer preserves reply and thread semantics", async () => {
  const calls = [];
  const client = {
    async sendText(...args) {
      calls.push(["text", ...args]);
    },
    async sendInteractive(...args) {
      calls.push(["card", ...args]);
      return "om_outbound";
    },
    async updateInteractive() {},
  };
  const renderer = new AgentStreamHandler(client, () => {});

  await renderer.sendText(target, "system");
  await renderer.sendBlock(target, "text", "answer");
  await renderer.onRequestPermission(
    target,
    {
      sessionId: "session-1",
      options: [{ kind: "allow_once", optionId: "allow", name: "Allow" }],
    },
    "callback-1",
  );

  assert.deepEqual(calls[0], [
    "text",
    "oc_group",
    "system",
    "om_inbound",
    true,
  ]);
  for (const call of calls.slice(1)) {
    assert.equal(call[1], "oc_group");
    assert.equal(call[3], "om_inbound");
    assert.equal(call[4], true);
  }
});

test("Feishu renderer surfaces agent reply delivery failures", async () => {
  const client = {
    async sendInteractive() {
      throw new Error("send failed");
    },
    async updateInteractive() {
      throw new Error("update failed");
    },
  };
  const renderer = new AgentStreamHandler(client, () => {});

  await assert.rejects(
    renderer.sendBlock(target, "text", "answer"),
    /send failed/,
  );
  await assert.rejects(
    renderer.editBlock(target, "om_outbound", "text", "answer", false),
    /update failed/,
  );
  await assert.rejects(
    renderer.onAfterTurnError(target, "agent failed"),
    /send failed/,
  );
});

test("Feishu client sets reply_in_thread on reply API requests", async () => {
  const requests = [];
  const client = Object.create(FeishuClient.prototype);
  client.sdk = {
    im: {
      message: {
        async reply(request) {
          requests.push(request);
          return { data: { message_id: "om_outbound" } };
        },
      },
    },
  };

  await client.sendInteractive(
    "oc_group",
    { schema: "2.0" },
    "om_inbound",
    true,
  );

  assert.deepEqual(requests[0], {
    path: { message_id: "om_inbound" },
    data: {
      msg_type: "interactive",
      content: JSON.stringify({ schema: "2.0" }),
      reply_in_thread: true,
    },
  });
});

test("Feishu client rejects API error responses for agent reply delivery", async () => {
  const client = Object.create(FeishuClient.prototype);
  client.sdk = {
    im: {
      message: {
        async create() {
          return { code: 230001, msg: "send denied" };
        },
        async patch() {
          return { code: 230002, msg: "update denied" };
        },
      },
    },
  };

  await assert.rejects(
    client.sendInteractive("oc_group", { schema: "2.0" }),
    /Feishu interactive send failed: send denied/,
  );
  await assert.rejects(
    client.updateInteractive("om_outbound", { schema: "2.0" }),
    /Feishu interactive update failed: update denied/,
  );
});
