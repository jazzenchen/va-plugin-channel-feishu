export function shouldHandleInboundMessage(params: {
  chatType: "p2p" | "group";
  mentionedBot: boolean;
}): boolean {
  if (params.chatType === "p2p") return true;
  return params.mentionedBot;
}
