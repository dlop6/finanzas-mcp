import { describe, expect, it, vi } from "vitest";
import {
  createContextCompactor,
  estimateApproximateTokens,
  loadContextCompactionConfig,
  selectRecentConversationMessages,
} from "@/host/context";

const summary = {
  factsAndDecisions: ["The user chose cash flow reports."],
  referenceData: ["Account 1 is cash."],
  financialContext: ["The balance was GTQ 100.00."],
  activePendingItems: ["Review the monthly report."],
};

function messages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Message ${index} with enough deterministic content to estimate tokens.`,
  }));
}

describe("context compactor", () => {
  it("loads the default threshold and rejects invalid explicit values", () => {
    expect(loadContextCompactionConfig({}).threshold).toBe(6000);
    expect(loadContextCompactionConfig({ CONTEXT_COMPACTION_THRESHOLD: "42" }).threshold).toBe(42);
    expect(() => loadContextCompactionConfig({ CONTEXT_COMPACTION_THRESHOLD: "0" })).toThrow("positive integer");
  });

  it("estimates tokens deterministically and retains whole recent turns", () => {
    expect(estimateApproximateTokens({ a: "1234" })).toBe(3);
    const history = [
      { role: "user" as const, content: "old" },
      { role: "assistant" as const, content: null, toolCalls: [{ id: "call-1", type: "function" as const, function: { name: "get_current_balance", arguments: "{}" } }] },
      { role: "tool" as const, toolCallId: "call-1", content: "{}" },
      { role: "assistant" as const, content: "old result" },
      ...messages(7),
    ];
    const recent = selectRecentConversationMessages(history);
    expect(recent[0]).toEqual({ role: "user", content: "old" });
    expect(recent).toHaveLength(history.length);
  });

  it("does not call DeepSeek at or below the threshold", async () => {
    const sendChat = vi.fn();
    const compactor = createContextCompactor({ deepSeekClient: { sendChat }, config: { threshold: 10_000 } });
    const result = await compactor.compactIfNeeded({ conversationSummary: null, messages: messages(10) });
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages(10));
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("summarizes only old messages in JSON mode and retains recent messages", async () => {
    const sendChat = vi.fn().mockResolvedValue({ content: JSON.stringify(summary), toolCalls: [], model: "test", finishReason: "stop" });
    const history = messages(12);
    const compactor = createContextCompactor({ deepSeekClient: { sendChat }, config: { threshold: 1 } });
    const result = await compactor.compactIfNeeded({ conversationSummary: null, messages: history });
    expect(result.compacted).toBe(true);
    expect(result.conversationSummary).toEqual(summary);
    expect(result.messages).toEqual(history.slice(4));
    expect(sendChat.mock.calls[0][1]).toBeUndefined();
    expect(sendChat.mock.calls[0][2]).toEqual({ responseFormat: "json_object" });
    expect(sendChat.mock.calls[0][0][1].content).toContain("Message 0");
    expect(sendChat.mock.calls[0][0][1].content).not.toContain("Message 4");
  });

  it("includes an earlier summary and rejects malformed replacement summaries", async () => {
    const sendChat = vi.fn().mockResolvedValue({ content: "{}", toolCalls: [], model: "test", finishReason: "stop" });
    const compactor = createContextCompactor({ deepSeekClient: { sendChat }, config: { threshold: 1 } });
    await expect(compactor.compactIfNeeded({ conversationSummary: summary, messages: messages(12) })).rejects.toMatchObject({ code: "INVALID_SUMMARY" });
    expect(sendChat.mock.calls[0][0][1].content).toContain("previousSummary");
  });
});
