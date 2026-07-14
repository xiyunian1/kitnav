export const requiredDatabaseIndexes = Object.freeze([
  { name: "User_createdAt_idx", table: "User", columns: ["createdAt"] },
  { name: "Account_userId_idx", table: "Account", columns: ["userId"] },
  { name: "Session_userId_idx", table: "Session", columns: ["userId"] },
  {
    name: "Generation_module_createdAt_idx",
    table: "Generation",
    columns: ["module", "createdAt"],
  },
  {
    name: "CreditTransaction_type_createdAt_idx",
    table: "CreditTransaction",
    columns: ["type", "createdAt"],
  },
  { name: "Order_createdAt_idx", table: "Order", columns: ["createdAt"] },
  {
    name: "Order_status_paidAt_idx",
    table: "Order",
    columns: ["status", "paidAt"],
  },
  {
    name: "AdminAuditLog_createdAt_idx",
    table: "AdminAuditLog",
    columns: ["createdAt"],
  },
  {
    name: "RegistrationEvent_userId_createdAt_idx",
    table: "RegistrationEvent",
    columns: ["userId", "createdAt"],
  },
  {
    name: "Feedback_createdAt_idx",
    table: "Feedback",
    columns: ["createdAt"],
  },
  {
    name: "ImageTurn_status_createdAt_idx",
    table: "ImageTurn",
    columns: ["status", "createdAt"],
  },
  {
    name: "ImageTurn_status_workerLease_createdAt_idx",
    table: "ImageTurn",
    columns: ["status", "workerLease", "createdAt"],
  },
  {
    name: "PptProject_status_workerLease_createdAt_idx",
    table: "PptProject",
    columns: ["status", "workerLease", "createdAt"],
  },
  {
    name: "Material_visibility_status_updatedAt_idx",
    table: "Material",
    columns: ["visibility", "status", "updatedAt"],
  },
  {
    name: "MaterialReport_reporterId_idx",
    table: "MaterialReport",
    columns: ["reporterId"],
  },
]);

export const removedDatabaseIndexes = Object.freeze([
  "Generation_module_idx",
  "PptSlide_projectId_order_idx",
]);

export function quoteIdentifier(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

export function normalizeIndexColumn(value) {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll('""', '"')
    : value;
}
