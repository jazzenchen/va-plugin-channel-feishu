import assert from "node:assert/strict";
import test from "node:test";

import { FeishuClient } from "../dist/lark-client.js";

test("health follows the Feishu WebSocket lifecycle", () => {
  const client = new FeishuClient({ app_id: "cli_0000000000000000", app_secret: "secret" });

  assert.equal(client.isWSConnected(), false);
  client.wsClient = { getConnectionStatus: () => ({ state: "reconnecting" }) };
  assert.equal(client.isWSConnected(), false);
  client.wsClient = { getConnectionStatus: () => ({ state: "connected" }) };
  assert.equal(client.isWSConnected(), true);
});
