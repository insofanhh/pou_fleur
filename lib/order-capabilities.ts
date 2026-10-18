export function orderCapabilities(role: string) {
  return {
    create: ["owner", "admin", "manager", "support"].includes(role),
    confirm: ["owner", "admin", "manager"].includes(role),
    adjust: ["owner", "admin", "manager"].includes(role),
    collect: role === "owner",
  };
}
