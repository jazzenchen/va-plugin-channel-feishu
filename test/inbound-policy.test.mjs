import assert from "node:assert/strict";
import test from "node:test";

import { shouldHandleInboundMessage } from "../dist/messaging/inbound/policy.js";

test("direct messages do not require a mention", () => {
  assert.equal(
    shouldHandleInboundMessage({ chatType: "p2p", mentionedBot: false, text: "hello" }),
    true,
  );
});

test("ordinary group messages require a bot mention", () => {
  assert.equal(
    shouldHandleInboundMessage({ chatType: "group", mentionedBot: false, text: "hello" }),
    false,
  );
  assert.equal(
    shouldHandleInboundMessage({ chatType: "group", mentionedBot: true, text: "hello" }),
    true,
  );
});

test("explicit slash commands remain valid in groups", () => {
  assert.equal(
    shouldHandleInboundMessage({ chatType: "group", mentionedBot: false, text: "  /new" }),
    true,
  );
});
