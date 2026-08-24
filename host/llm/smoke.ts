import "dotenv/config";
import { DeepSeekClientError, createDeepSeekClient } from "./deepseek-client";
import { sendGeneralChat } from "./general-chat";

async function main(): Promise<void> {
  const result = await sendGeneralChat(createDeepSeekClient(), {
    systemPrompt: "You are a concise and helpful general assistant.",
    history: [],
    userMessage: "Reply with one short sentence confirming that the general chat connection works.",
  });

  if (!result.content) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned no text for the smoke test.");
  }

  console.log(result.content);
  console.log("DeepSeek smoke test succeeded.");
}

try {
  await main();
} catch (error) {
  if (error instanceof DeepSeekClientError) {
    const status = error.status === undefined ? "" : ` (HTTP ${error.status})`;
    console.error(`DeepSeek smoke test failed: ${error.code}${status}.`);
  } else {
    console.error("DeepSeek smoke test failed.");
  }
  process.exitCode = 1;
}
