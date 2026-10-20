// Explicit preload for isolated QA server only; never loaded by application code.
if (process.env.MYSQL_DATABASE !== "fleur_saas_test" || process.env.MYSQL_PORT !== "3310") throw Error("AI mock requires isolated QA database");
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.deepseek.com/chat/completions") return original(url, init);
  const body = JSON.parse(init.body), last = body.messages.at(-1);
  const reply = (message, finish_reason = "stop") => Response.json({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
  if (last.role === "tool") return reply({ content: "Đã lấy dữ liệu. Hãy kiểm tra thẻ bên dưới; hành động vẫn chờ bạn xác nhận." });
  if (Array.isArray(last.content)) {
    const image = last.content.find(part => part.type === "image_url");
    if (!image?.image_url?.url.startsWith("data:image/")) throw Error("QA image transport missing");
    return reply({ content: "QA đã nhận ảnh riêng tư và văn bản." });
  }
  const text = last.content || "";
  if (text.includes("Báo cáo hoạt động trong 7 ngày gần nhất")) {
    const today = body.messages[0].content.match(/Hôm nay Hà Nội: (\d{4}-\d{2}-\d{2})/)[1];
    // Deliberately wrong inclusive start and unsolicited comparison. Backend
    // must correct the period and strip prior data unless explicitly requested.
    const from = new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10);
    return reply({ content: null, tool_calls: [{ id: "qa-report", type: "function", function: { name: "get_store_metrics", arguments: JSON.stringify({ from, to: today, comparePrevious: true }) } }] }, "tool_calls");
  }
  if (text === "QA_IMAGE_HISTORY") {
    if (!body.messages.some(message => message.role === "user" && Array.isArray(message.content) && message.content.some(part => part.type === "image_url"))) throw Error("QA history image missing");
    return reply({ content: "QA còn ảnh trong lịch sử." });
  }
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
