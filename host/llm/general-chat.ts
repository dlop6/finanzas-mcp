import type {
  DeepSeekChatMessage,
  DeepSeekChatResult,
  DeepSeekClient,
} from "./deepseek-client";

export type GeneralChatInput = {
  systemPrompt: string;
  history: ReadonlyArray<Pick<DeepSeekChatMessage, "role" | "content">>;
  userMessage: string;
};

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must contain text.`);
  }
  return value;
}

export async function sendGeneralChat(
  client: Pick<DeepSeekClient, "sendChat">,
  input: GeneralChatInput,
): Promise<DeepSeekChatResult> {
  requireText(input.systemPrompt, "systemPrompt");
  requireText(input.userMessage, "userMessage");

  const history: DeepSeekChatMessage[] = input.history.map((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("history contains an invalid role.");
    }
    requireText(message.content, "history message");
    return { role: message.role, content: message.content };
  });

  return client.sendChat([
    { role: "system", content: input.systemPrompt },
    ...history,
    { role: "user", content: input.userMessage },
  ]);
}
