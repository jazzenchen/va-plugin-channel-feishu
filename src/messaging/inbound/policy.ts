export function isExplicitSlashCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

export function shouldHandleInboundMessage(params: {
  chatType: "p2p" | "group";
  mentionedBot: boolean;
  text: string;
}): boolean {
  if (params.chatType === "p2p") return true;
  return params.mentionedBot || isExplicitSlashCommand(params.text);
}
