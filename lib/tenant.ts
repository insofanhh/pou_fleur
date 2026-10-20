import { AsyncLocalStorage } from "node:async_hooks";
import sqlParser from "node-sql-parser";

type Scope = { storeId: number } | { system: true };
const scopes = new AsyncLocalStorage<Scope>();
export const withStore = <T>(storeId: number, work: () => T): T => {
  if (!Number.isSafeInteger(storeId) || storeId < 1)
    throw Error("Invalid store scope");
  return scopes.run({ storeId }, work);
};
// Only trusted server jobs and platform services may opt out of tenant filtering.
export const withSystem = <T>(work: () => T): T =>
  scopes.run({ system: true }, work);
export const activeStoreId = () => {
  const s = scopes.getStore();
  return s && "storeId" in s ? s.storeId : null;
};
export const tenantId = () => {
  const scope = scopes.getStore();
  if (!scope || !("storeId" in scope)) throw Error("Store scope required");
  return scope.storeId;
};
const tables = new Set([
  "products",
  "categories",
  "flower_components",
  "product_flower_components",
  "orders",
  "order_items",
  "promotions",
  "customers",
  "crm_notes",
  "crm_tasks",
  "events",
  "posts",
  "inquiries",
  "audit_logs",
  "email_templates",
  "email_campaigns",
  "email_suppressions",
  "email_outbox",
  "crm_automations",
  "calendar_notes",
  "order_status_events",
  "order_payments",
  "order_drafts",
  "assets",
  "store_bank_accounts",
  "payment_intents",
  "ai_conversations",
  "ai_runs",
  "ai_messages",
  "ai_tool_calls",
  "ai_action_drafts",
  "workspace_reminders",
  "ai_issue_reports",
  "workspace_activity",
]);
const parser = new sqlParser.Parser();
const condition = (table: string, id: number) => ({
  type: "binary_expr",
  operator: "=",
  left: { type: "column_ref", table, column: "store_id" },
  right: { type: "number", value: id },
});
const and = (left: any, right: any) =>
  left
    ? {
        type: "binary_expr",
        operator: "AND",
        left: { ...left, parentheses: true },
        right,
      }
    : right;

// Parse SQL rather than text replacement: nested SELECTs, aliases, joins and
// UPDATE/DELETE all receive a scope. Unsupported statements fail closed.
export function scopedSQL(sql: string): string {
  const scope = scopes.getStore();
  if (scope && "system" in scope) return sql;
  if (![...tables].some((t) => new RegExp(`\\b${t}\\b`, "i").test(sql)))
    return sql;
  const id = tenantId();
  const ast: any = parser.astify(sql, { database: "MySQL" });
  if (Array.isArray(ast)) throw Error("Multiple scoped statements forbidden");
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    // Visit child queries first, without revisiting predicates we add below.
    Object.values(node).forEach(visit);
    if (
      node.type === "select" ||
      node.type === "delete" ||
      node.type === "update"
    ) {
      const refs = node.type === "update" ? node.table : node.from;
      for (const ref of refs || []) {
        if (!tables.has(ref.table?.toLowerCase())) continue;
        if (ref.db) throw Error("Cross database query forbidden");
        const predicate = condition(ref.as || ref.table, id);
        if (ref.join && ref.on) ref.on = and(ref.on, predicate);
        else node.where = and(node.where, predicate);
      }
      if (
        node.type === "update" &&
        node.set?.some((s: any) => s.column === "store_id")
      )
        throw Error("Cannot change store ownership");
    } else if (node.type === "insert" || node.type === "replace") {
      if (!tables.has(node.table?.[0]?.table?.toLowerCase())) return;
      if (
        !node.columns ||
        node.columns.includes("store_id") ||
        node.values?.type !== "values"
      )
        throw Error("Invalid scoped insert");
      node.columns.push("store_id");
      for (const row of node.values.values)
        row.value.push({ type: "number", value: id });
      if (
        node.on_duplicate_update?.set?.some((s: any) => s.column === "store_id")
      )
        throw Error("Cannot change store ownership");
    }
  };
  if (!["select", "insert", "update", "delete"].includes(ast.type))
    throw Error("Unsupported scoped SQL");
  visit(ast);
  return parser.sqlify(ast, { database: "MySQL" });
}
