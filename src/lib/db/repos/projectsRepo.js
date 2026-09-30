import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    defaultModel: row.defaultModel || "auto",
    routingMode: row.routingMode || "balanced",
    allowedProviders: parseJson(row.allowedProviders, []),
    allowedModels: parseJson(row.allowedModels, []),
    fallbackSequence: parseJson(row.fallbackSequence, []),
    timeoutMs: row.timeoutMs != null ? Number(row.timeoutMs) : null,
    usageLimit: row.usageLimit != null ? Number(row.usageLimit) : null,
    currentSpend: Number(row.currentSpend || 0),
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getProjects(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.all(`SELECT * FROM projects ${whereClause} ORDER BY createdAt DESC`, params);
  return rows.map(rowToProject);
}

export async function getProjectById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM projects WHERE id = ?`, [id]);
  return rowToProject(row);
}

export async function getProjectByName(name) {
  if (!name) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM projects WHERE name = ?`, [name]);
  return rowToProject(row);
}

export async function createProject(data) {
  if (!data?.name?.trim()) throw new Error("Project name is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const project = {
    id: data.id || uuidv4(),
    name: data.name.trim(),
    description: data.description?.trim() || "",
    defaultModel: data.defaultModel?.trim() || "auto",
    routingMode: data.routingMode?.trim() || "balanced",
    allowedProviders: Array.isArray(data.allowedProviders) ? data.allowedProviders : [],
    allowedModels: Array.isArray(data.allowedModels) ? data.allowedModels : [],
    fallbackSequence: Array.isArray(data.fallbackSequence) ? data.fallbackSequence : [],
    timeoutMs: data.timeoutMs ? Number(data.timeoutMs) : null,
    usageLimit: data.usageLimit != null ? Number(data.usageLimit) : null,
    currentSpend: 0,
    isActive: data.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO projects(
       id, name, description, defaultModel, routingMode,
       allowedProviders, allowedModels, fallbackSequence,
       timeoutMs, usageLimit, currentSpend, isActive,
       createdAt, updatedAt
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.description,
      project.defaultModel,
      project.routingMode,
      stringifyJson(project.allowedProviders),
      stringifyJson(project.allowedModels),
      stringifyJson(project.fallbackSequence),
      project.timeoutMs,
      project.usageLimit,
      project.currentSpend,
      project.isActive ? 1 : 0,
      project.createdAt,
      project.updatedAt,
    ]
  );

  return project;
}

export async function updateProject(id, data) {
  if (!id) return null;
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM projects WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToProject(row);
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE projects SET
         name = ?,
         description = ?,
         defaultModel = ?,
         routingMode = ?,
         allowedProviders = ?,
         allowedModels = ?,
         fallbackSequence = ?,
         timeoutMs = ?,
         usageLimit = ?,
         currentSpend = ?,
         isActive = ?,
         updatedAt = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.description,
        merged.defaultModel,
        merged.routingMode,
        stringifyJson(merged.allowedProviders || []),
        stringifyJson(merged.allowedModels || []),
        stringifyJson(merged.fallbackSequence || []),
        merged.timeoutMs != null ? Number(merged.timeoutMs) : null,
        merged.usageLimit != null ? Number(merged.usageLimit) : null,
        merged.currentSpend != null ? Number(merged.currentSpend) : 0,
        merged.isActive ? 1 : 0,
        merged.updatedAt,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function incrementProjectSpend(id, cost = 0) {
  if (!id) return;
  try {
    const db = await getAdapter();
    const safeCost = typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0;
    if (safeCost > 0) {
      db.run(`UPDATE projects SET currentSpend = currentSpend + ? WHERE id = ?`, [safeCost, id]);
    }
  } catch (err) {
    console.error("[projectsRepo] Failed to increment project spend:", err.message);
  }
}

export async function deleteProject(id) {
  if (!id) return false;
  const db = await getAdapter();
  let deleted = false;
  db.transaction(() => {
    // Unassign apiKeys linked to this project
    db.run(`UPDATE apiKeys SET projectId = NULL WHERE projectId = ?`, [id]);
    const res = db.run(`DELETE FROM projects WHERE id = ?`, [id]);
    deleted = (res?.changes ?? 0) > 0;
  });
  return deleted;
}
