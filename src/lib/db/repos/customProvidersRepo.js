import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiType: row.apiType || "openai-compatible",
    authHeader: row.authHeader || "Authorization",
    authPrefix: row.authPrefix != null ? row.authPrefix : "Bearer ",
    encryptedApiKey: row.encryptedApiKey || null,
    hasApiKey: Boolean(row.encryptedApiKey),
    models: parseJson(row.models, []),
    timeoutMs: Number(row.timeoutMs || 60000),
    customHeaders: parseJson(row.customHeaders, {}),
    modelAliases: parseJson(row.modelAliases, {}),
    responseMapping: parseJson(row.responseMapping, null),
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCustomProviders(filter = {}, includeSecret = false) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.all(`SELECT * FROM customProviders ${whereClause} ORDER BY createdAt DESC`, params);
  return rows.map((r) => {
    const prov = rowToProvider(r);
    if (!includeSecret) delete prov.encryptedApiKey;
    return prov;
  });
}

export async function getCustomProviderById(id, includeSecret = false) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customProviders WHERE id = ?`, [id]);
  const prov = rowToProvider(row);
  if (!prov) return null;
  if (!includeSecret) {
    delete prov.encryptedApiKey;
  }
  return prov;
}

export async function createCustomProvider(data) {
  if (!data?.name?.trim()) throw new Error("Provider name is required");
  if (!data?.baseUrl?.trim()) throw new Error("Base URL is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const provider = {
    id: data.id || `custom-${uuidv4()}`,
    name: data.name.trim(),
    baseUrl: data.baseUrl.trim().replace(/\/+$/, ""),
    apiType: data.apiType || "openai-compatible",
    authHeader: data.authHeader || "Authorization",
    authPrefix: data.authPrefix != null ? data.authPrefix : "Bearer ",
    encryptedApiKey: data.encryptedApiKey || null,
    models: Array.isArray(data.models) ? data.models : [],
    timeoutMs: data.timeoutMs ? Math.max(5000, Math.min(Number(data.timeoutMs), 900000)) : 60000,
    customHeaders: data.customHeaders && typeof data.customHeaders === "object" ? data.customHeaders : {},
    modelAliases: data.modelAliases && typeof data.modelAliases === "object" ? data.modelAliases : {},
    responseMapping: data.responseMapping || null,
    isActive: data.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO customProviders(
       id, name, baseUrl, apiType, authHeader, authPrefix,
       encryptedApiKey, models, timeoutMs, customHeaders,
       modelAliases, responseMapping, isActive, createdAt, updatedAt
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      provider.id,
      provider.name,
      provider.baseUrl,
      provider.apiType,
      provider.authHeader,
      provider.authPrefix,
      provider.encryptedApiKey,
      stringifyJson(provider.models),
      provider.timeoutMs,
      stringifyJson(provider.customHeaders),
      stringifyJson(provider.modelAliases),
      stringifyJson(provider.responseMapping),
      provider.isActive ? 1 : 0,
      provider.createdAt,
      provider.updatedAt,
    ]
  );

  const safeResult = { ...provider };
  delete safeResult.encryptedApiKey;
  safeResult.hasApiKey = Boolean(provider.encryptedApiKey);
  return safeResult;
}

export async function updateCustomProvider(id, data) {
  if (!id) return null;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM customProviders WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToProvider(row);
    // Keep existing encryptedApiKey if not explicitly overwritten
    const encryptedApiKey = data.encryptedApiKey !== undefined ? data.encryptedApiKey : row.encryptedApiKey;
    const merged = {
      ...current,
      ...data,
      encryptedApiKey,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE customProviders SET
         name = ?,
         baseUrl = ?,
         apiType = ?,
         authHeader = ?,
         authPrefix = ?,
         encryptedApiKey = ?,
         models = ?,
         timeoutMs = ?,
         customHeaders = ?,
         modelAliases = ?,
         responseMapping = ?,
         isActive = ?,
         updatedAt = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.baseUrl,
        merged.apiType,
        merged.authHeader,
        merged.authPrefix,
        merged.encryptedApiKey,
        stringifyJson(merged.models || []),
        merged.timeoutMs != null ? Number(merged.timeoutMs) : 60000,
        stringifyJson(merged.customHeaders || {}),
        stringifyJson(merged.modelAliases || {}),
        stringifyJson(merged.responseMapping || null),
        merged.isActive ? 1 : 0,
        merged.updatedAt,
        id,
      ]
    );
    const safeMerged = { ...merged };
    delete safeMerged.encryptedApiKey;
    safeMerged.hasApiKey = Boolean(merged.encryptedApiKey);
    result = safeMerged;
  });
  return result;
}

export async function deleteCustomProvider(id) {
  if (!id) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customProviders WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
