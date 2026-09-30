// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
// Kept for backward compatibility with existing imports.
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl,
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey, incrementKeyUsage,
  getProjects, getProjectById, getProjectByName, createProject, updateProject, deleteProject, incrementProjectSpend,
  upsertProviderHealth, getAllProviderHealth, getProviderHealth, getUnhealthyTargets, deleteProviderHealth, buildHealthId,
  getCustomProviders, getCustomProviderById, createCustomProvider, updateCustomProvider, deleteCustomProvider,
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  exportDb, importDb,
} from "@/lib/db/index.js";
