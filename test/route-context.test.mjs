import assert from "node:assert/strict";
import test from "node:test";

import {
  createFeishuCallbackContext,
  serializeFeishuCallbackData,
} from "../dist/route-context.js";

test("Feishu callback metadata preserves every available route field", () => {
  assert.deepEqual(
    createFeishuCallbackContext({
      channelInstanceId: "feishu-primary",
      actorId: "codex-reviewer",
      chatId: "oc_group",
      topicId: "omt_thread",
      senderId: "ou_sender",
      platformMessageId: "om_message",
      scope: "group",
    }),
    {
      channelInstanceId: "feishu-primary",
      actorId: "codex-reviewer",
      chatId: "oc_group",
      topicId: "omt_thread",
      senderId: "ou_sender",
      platformMessageId: "om_message",
      scope: "group",
      addressedBy: "callback",
    },
  );
});

test("Feishu callback data stays a host-consumable string", () => {
  assert.equal(
    serializeFeishuCallbackData({ action: "approve", count: 2 }),
    '{"action":"approve","count":2}',
  );
  assert.equal(serializeFeishuCallbackData(undefined), "{}");
});
