import assert from "node:assert/strict";
import test from "node:test";

import { shouldHandleInboundMessage } from "../dist/messaging/inbound/policy.js";

test("direct messages do not require a mention", () => {
  assert.equal(
    shouldHandleInboundMessage({ chatType: "p2p", mentionedBot: false }),
    true,
  );
});

test("ordinary group messages require a bot mention", () => {
  assert.equal(
    shouldHandleInboundMessage({ chatType: "group", mentionedBot: false }),
    false,
  );
  assert.equal(
    shouldHandleInboundMessage({ chatType: "group", mentionedBot: true }),
    true,
  );
});
