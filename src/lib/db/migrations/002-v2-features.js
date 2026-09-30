import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "v2-features",
  up(db) {
    // 1. Create new tables if not exists
    const newTables = ["projects", "providerHealth", "customProviders"];
    for (const name of newTables) {
      if (TABLES[name]) {
        db.exec(buildCreateTableSql(name, TABLES[name]));
        for (const idx of TABLES[name].indexes || []) {
          try { db.exec(idx); } catch { /* ignore if index exists */ }
        }
      }
    }

    // 2. Safe additive columns for apiKeys
    const apiKeyCols = [
      { name: "permissions", def: "TEXT" },
      { name: "projectId", def: "TEXT" },
      { name: "requestCount", def: "INTEGER DEFAULT 0" },
      { name: "totalSpend", def: "REAL DEFAULT 0" },
      { name: "updatedAt", def: "TEXT" },
    ];
    try {
      const existingKeyCols = new Set((db.all("PRAGMA table_info(apiKeys)") || []).map((r) => r.name));
      for (const col of apiKeyCols) {
        if (!existingKeyCols.has(col.name)) {
          try { db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col.name} ${col.def}`); } catch {}
        }
      }
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_ak_project ON apiKeys(projectId)"); } catch {}
    } catch {}

    // 3. Safe additive columns for requestDetails
    const reqDetailCols = [
      { name: "apiKeyId", def: "TEXT" },
      { name: "projectId", def: "TEXT" },
      { name: "requestedModel", def: "TEXT" },
      { name: "selectedModel", def: "TEXT" },
      { name: "routingMode", def: "TEXT" },
      { name: "httpStatus", def: "INTEGER" },
      { name: "errorCategory", def: "TEXT" },
      { name: "totalDuration", def: "INTEGER" },
      { name: "estimatedCost", def: "REAL DEFAULT 0" },
    ];
    try {
      const existingReqCols = new Set((db.all("PRAGMA table_info(requestDetails)") || []).map((r) => r.name));
      for (const col of reqDetailCols) {
        if (!existingReqCols.has(col.name)) {
          try { db.exec(`ALTER TABLE requestDetails ADD COLUMN ${col.name} ${col.def}`); } catch {}
        }
      }
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_rd_apikey ON requestDetails(apiKeyId)"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_rd_project ON requestDetails(projectId)"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_rd_status ON requestDetails(status)"); } catch {}
    } catch {}
  },
};

export default migration;
