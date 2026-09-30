import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    permissions: parseJson(row.permissions, null),
    projectId: row.projectId || null,
    requestCount: Number(row.requestCount || 0),
    totalSpend: Number(row.totalSpend || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
  };
}

export async function getApiKeys(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.projectId) {
    where.push("projectId = ?");
    params.push(filter.projectId);
  }
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.all(`SELECT * FROM apiKeys ${whereClause} ORDER BY createdAt ASC`, params);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const permissionsJson = options.permissions != null ? stringifyJson(options.permissions) : null;
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: options.isActive !== false,
    permissions: options.permissions || null,
    projectId: options.projectId || null,
    requestCount: 0,
    totalSpend: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, permissions, projectId, requestCount, totalSpend, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      apiKey.isActive ? 1 : 0,
      permissionsJson,
      apiKey.projectId,
      0,
      0,
      apiKey.createdAt,
      apiKey.updatedAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    const permissionsJson = merged.permissions != null ? stringifyJson(merged.permissions) : null;
    db.run(
      `UPDATE apiKeys SET
         key = ?,
         name = ?,
         machineId = ?,
         isActive = ?,
         permissions = ?,
         projectId = ?,
         requestCount = ?,
         totalSpend = ?,
         updatedAt = ?
       WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        permissionsJson,
        merged.projectId || null,
        merged.requestCount || 0,
        merged.totalSpend || 0,
        merged.updatedAt,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function incrementKeyUsage(keyOrId, cost = 0) {
  if (!keyOrId) return;
  try {
    const db = await getAdapter();
    const safeCost = typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0;
    db.run(
      `UPDATE apiKeys SET requestCount = requestCount + 1, totalSpend = totalSpend + ? WHERE id = ? OR key = ?`,
      [safeCost, keyOrId, keyOrId]
    );
  } catch (err) {
    console.error("[apiKeysRepo] Failed to increment key usage:", err.message);
  }
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
