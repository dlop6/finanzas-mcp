import type {
  DeepSeekChatResult,
  DeepSeekClient,
} from "./deepseek-client";

type GeneralChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type GeneralChatInput = {
  systemPrompt: string;
  history: ReadonlyArray<GeneralChatHistoryMessage>;
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

  const history: GeneralChatHistoryMessage[] = input.history.map((message) => {
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
