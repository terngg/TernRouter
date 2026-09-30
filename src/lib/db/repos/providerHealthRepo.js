import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToHealth(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    connectionId: row.connectionId || null,
    model: row.model || null,
    status: row.status,
    latencyMs: row.latencyMs != null ? Number(row.latencyMs) : null,
    error: row.error || null,
    quota: parseJson(row.quota, null),
    lastTested: row.lastTested,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function buildHealthId(provider, connectionId = null, model = null) {
  const parts = [provider];
  if (connectionId) parts.push(connectionId);
  if (model) parts.push(model);
  return parts.join(":");
}

export async function upsertProviderHealth(data) {
  if (!data?.provider) throw new Error("provider is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = data.id || buildHealthId(data.provider, data.connectionId, data.model);
  const status = data.status || "unknown";
  const quotaJson = data.quota ? stringifyJson(data.quota) : null;
  const latencyMs = data.latencyMs != null ? Number(data.latencyMs) : null;
  const error = data.error || null;

  db.run(
    `INSERT INTO providerHealth(
       id, provider, connectionId, model, status,
       latencyMs, error, quota, lastTested, createdAt, updatedAt
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       latencyMs = excluded.latencyMs,
       error = excluded.error,
       quota = excluded.quota,
       lastTested = excluded.lastTested,
       updatedAt = excluded.updatedAt`,
    [
      id,
      data.provider,
      data.connectionId || null,
      data.model || null,
      status,
      latencyMs,
      error,
      quotaJson,
      data.lastTested || now,
      now,
      now,
    ]
  );

  return {
    id,
    provider: data.provider,
    connectionId: data.connectionId || null,
    model: data.model || null,
    status,
    latencyMs,
    error,
    quota: data.quota || null,
    lastTested: data.lastTested || now,
    updatedAt: now,
  };
}

export async function getAllProviderHealth() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM providerHealth ORDER BY lastTested DESC`);
  return rows.map(rowToHealth);
}

export const getProviderHealthList = getAllProviderHealth;

export async function getProviderHealth(provider, connectionId = null, model = null) {
  const db = await getAdapter();
  const id = buildHealthId(provider, connectionId, model);
  const row = db.get(`SELECT * FROM providerHealth WHERE id = ?`, [id]);
  if (row) return rowToHealth(row);

  // Fallback to provider-level health if connection or model-specific isn't found
  if (connectionId || model) {
    const parentId = buildHealthId(provider);
    const parentRow = db.get(`SELECT * FROM providerHealth WHERE id = ?`, [parentId]);
    if (parentRow) return rowToHealth(parentRow);
  }
  return null;
}

export async function getUnhealthyTargets() {
  const db = await getAdapter();
  // Return records where status is not "healthy" and tested recently (within last 30 minutes)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const rows = db.all(
    `SELECT * FROM providerHealth WHERE status NOT IN ('healthy', 'unknown') AND lastTested >= ?`,
    [cutoff]
  );
  return rows.map(rowToHealth);
}

export async function deleteProviderHealth(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM providerHealth WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
