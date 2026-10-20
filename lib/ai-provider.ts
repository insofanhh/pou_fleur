import { z } from "zod";

export type AIContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type AIMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | AIContentPart[] | null; tool_call_id?: string; tool_calls?: AIToolCall[] };
export type AIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type AITool = { type: "function"; function: { name: string; description: string; parameters: any } };
export class AIProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const responseSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal("function"), function: z.object({ name: z.string().max(100), arguments: z.string().max(18000) }) })).max(5).optional() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative() }).optional(),
});
export async function deepseekCompletion(
  key: string,
  model: "deepseek-flash" | "deepseek-v4-pro",
  messages: AIMessage[],
  tools: AITool[],
  maxTokens: number,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await transport("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), thinking: { type: "disabled" }, temperature: 0.2, max_tokens: maxTokens, stream: false }),
      cache: "no-store", signal,
    });
  } catch { throw new AIProviderError(503, "Chưa kết nối được DeepSeek. Yêu cầu chưa được tính lượt; vui lòng thử lại."); }
  if (!response.ok) {
    // Never forward provider bodies: they can include credentials or customer data.
    if ([401, 402, 403].includes(response.status)) throw new AIProviderError(503, "DeepSeek chưa sẵn sàng. Admin platform cần kiểm tra API key, số dư hoặc quyền model.");
    throw new AIProviderError(503, "DeepSeek đang bận hoặc quá thời gian chờ. Vui lòng thử lại.");
  }
  let result: z.infer<typeof responseSchema>;
  try { result = responseSchema.parse(await response.json()); }
  catch { throw new AIProviderError(502, "DeepSeek trả về dữ liệu chưa hợp lệ. Chưa thực hiện thay đổi."); }
  const choice = result.choices[0];
  if (!["stop", "tool_calls"].includes(choice.finish_reason)) throw new AIProviderError(502, "Câu trả lời AI bị gián đoạn. Hãy chia yêu cầu thành các bước nhỏ hơn.");
  return { message: { role: "assistant", content: choice.message.content || "", ...(choice.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {}) } as AIMessage, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0 };
}
