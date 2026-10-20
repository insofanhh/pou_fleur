// Explicit preload for isolated QA server only; never loaded by application code.
if (process.env.MYSQL_DATABASE !== "fleur_saas_test" || process.env.MYSQL_PORT !== "3310") throw Error("AI mock requires isolated QA database");
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.deepseek.com/chat/completions") return original(url, init);
  const body = JSON.parse(init.body), last = body.messages.at(-1);
  const reply = (message, finish_reason = "stop") => Response.json({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
  if (last.role === "tool") return reply({ content: "Đã lấy dữ liệu. Hãy kiểm tra thẻ bên dưới; hành động vẫn chờ bạn xác nhận." });
  const text = last.content || "";
  if (text === "Trả lời đúng một từ: OK") return reply({ content: "OK" });
  if (text.startsWith("QA_ERROR")) return new Response("sk-provider-secret", { status: 401 });
  if (text.startsWith("QA_BAD")) return Response.json({ malformed: true });
  if (text.startsWith("QA_SLOW")) await new Promise(r => setTimeout(r, 1200));
  if (text.startsWith("QA_TOOL ")) {
    const { name, args } = JSON.parse(text.slice(8));
    return reply({ content: null, tool_calls: [{ id: "qa-call", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
  }
  return reply({ content: "Trợ lý QA sẵn sàng. Nội dung chưa thực hiện thay đổi." });
};
