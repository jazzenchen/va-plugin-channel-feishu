import type {
  ChannelInboundContext,
  ConversationScope,
} from "@vibearound/plugin-channel-sdk";

export interface FeishuCallbackRoute {
  channelInstanceId: string;
  actorId: string;
  chatId: string;
  topicId?: string;
  senderId?: string;
  platformMessageId?: string;
  scope: ConversationScope;
}

/** Build the extended route attached to Feishu callback notifications. */
export function createFeishuCallbackContext(
  route: FeishuCallbackRoute,
): ChannelInboundContext {
  return {
    ...route,
    addressedBy: "callback",
  };
}

export function serializeFeishuCallbackData(
  value: Record<string, unknown> | undefined,
): string {
  return JSON.stringify(value ?? {});
}
