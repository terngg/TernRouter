"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Modal, Toggle } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

export default function CustomProvidersPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);

  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    models: "",
    timeoutMs: "60000",
    customHeaders: "{}",
    enabled: true,
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.customProviders || []);
      }
    } catch (err) {
      console.error("Failed to fetch custom providers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/custom-providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setProviders(data.customProviders || []);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch custom providers:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleOpenCreate = () => {
    setEditingProvider(null);
    setTestResult(null);
    setFormData({
      name: "",
      baseUrl: "",
      apiKey: "",
      models: "",
      timeoutMs: "60000",
      customHeaders: "{}",
      enabled: true,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (p) => {
    setEditingProvider(p);
    setTestResult(null);
    setFormData({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "", // Masked for security
      models: (p.models || []).join(", "),
      timeoutMs: String(p.timeoutMs || 60000),
      customHeaders: JSON.stringify(p.customHeaders || {}, null, 2),
      enabled: p.enabled !== false,
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this custom provider?")) return;
    try {
      const res = await fetch(`/api/custom-providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchProviders();
      }
    } catch (err) {
      console.error("Delete custom provider failed:", err);
    }
  };

  const handleTestConnection = async (providerData, id = null) => {
    setTestingId(id || "modal");
    setTestResult(null);
    try {
      let res;
      if (id) {
        res = await fetch(`/api/custom-providers/${id}/test`, { method: "POST" });
      } else {
        res = await fetch("/api/custom-providers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: providerData.name,
            baseUrl: providerData.baseUrl,
            apiKey: providerData.apiKey,
            customHeaders: typeof providerData.customHeaders === "string" ? JSON.parse(providerData.customHeaders || "{}") : providerData.customHeaders,
            timeoutMs: Number(providerData.timeoutMs || 60000),
          }),
        });
      }
      const data = await res.json();
      setTestResult(data);
      if (id) {
        await fetchProviders();
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err.message,
        message: "Failed to run connection test",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let parsedHeaders = {};
    try {
      parsedHeaders = formData.customHeaders ? JSON.parse(formData.customHeaders) : {};
    } catch {
      alert("Invalid JSON in custom headers");
      return;
    }

    const payload = {
      name: formData.name,
      baseUrl: formData.baseUrl,
      models: formData.models.split(",").map((s) => s.trim()).filter(Boolean),
      timeoutMs: Number(formData.timeoutMs || 60000),
      customHeaders: parsedHeaders,
      enabled: formData.enabled,
    };
    if (formData.apiKey) {
      payload.apiKey = formData.apiKey;
    }

    try {
      const url = editingProvider ? `/api/custom-providers/${editingProvider.id}` : "/api/custom-providers";
      const method = editingProvider ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowModal(false);
        await fetchProviders();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save custom provider");
      }
    } catch (err) {
      console.error("Save custom provider failed:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-2xl text-primary">tune</span>
            <h1 className="text-2xl font-bold text-text-main">Custom Provider Adapters</h1>
          </div>
          <p className="text-sm text-text-muted">
            Connect OpenAI-compatible upstream providers with SSRF security validation, encrypted secrets, and custom headers.
          </p>
        </div>

        <Button variant="primary" onClick={handleOpenCreate} className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Custom Provider
        </Button>
      </div>

      {/* Security Banner */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-text-main">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">shield</span>
          <span>
            Enterprise SSRF Protection: Private ranges (10.0.0.0/8, 192.168.0.0/16, 127.0.0.1, 169.254.169.254) and internal hostnames are verified and blocked before dispatch.
          </span>
        </div>
      </div>

      {/* Providers Grid */}
      {loading ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted flex items-center justify-center gap-2">
            <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            Loading custom providers...
          </div>
        </Card>
      ) : providers.length === 0 ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted">
            No custom providers configured yet. Click &quot;Add Custom Provider&quot; to connect a self-hosted or third-party endpoint.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((cp) => {
            const isTesting = testingId === cp.id;

            return (
              <Card key={cp.id} padding="md" className="flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                        {cp.name}
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded font-mono font-normal",
                          cp.enabled
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-neutral-500/10 text-neutral-500"
                        )}>
                          {cp.enabled ? "Active" : "Disabled"}
                        </span>
                      </h3>
                      <div className="text-xs font-mono text-text-muted mt-1 break-all">
                        {cp.baseUrl}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(cp)}>
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(cp.id)}>
                        <span className="material-symbols-outlined text-[16px] text-rose-500">delete</span>
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-black/[0.02] dark:bg-white/[0.02] p-3 rounded-lg border border-black/5 dark:border-white/5">
                    <div>
                      <span className="text-text-muted block">Timeout:</span>
                      <span className="font-mono text-text-main">{cp.timeoutMs || 60000}ms</span>
                    </div>

                    <div>
                      <span className="text-text-muted block">Models:</span>
                      <span className="font-mono text-text-main">{cp.models?.length || 0} configured</span>
                    </div>
                  </div>

                  {/* Models list */}
                  {cp.models && cp.models.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold text-text-muted block mb-1">Available Models:</span>
                      <div className="flex flex-wrap gap-1">
                        {cp.models.map((m, idx) => (
                          <span key={idx} className="text-xs font-mono px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                            custom-{cp.id}/{m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                  <div className="text-xs text-text-muted font-mono">
                    ID: {cp.id.slice(0, 8)}...
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestConnection(cp, cp.id)}
                    disabled={isTesting}
                    className="flex items-center gap-1.5"
                  >
                    <span className={cn("material-symbols-outlined text-[16px]", isTesting && "animate-spin")}>
                      {isTesting ? "progress_activity" : "wifi_tethering"}
                    </span>
                    {isTesting ? "Testing..." : "Test Connection"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingProvider ? "Edit Custom Provider" : "Add Custom Provider"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Provider Name *</label>
            <Input
              required
              placeholder="e.g. Local vLLM, DeepSeek Self-hosted, Together"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Base URL *</label>
            <Input
              required
              placeholder="https://api.together.xyz/v1 or http://llm.internal:8000/v1"
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            />
            <p className="text-[11px] text-text-muted">Must be a valid HTTP/HTTPS endpoint. SSRF validation protects private networks.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">
              API Key / Authorization Secret {editingProvider && "(Leave blank to keep existing)"}
            </label>
            <Input
              type="password"
              placeholder={editingProvider ? "••••••••••••••••" : "Bearer token or API Key"}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            />
            <p className="text-[11px] text-text-muted">Encrypted securely on disk with AES-256-GCM. Never logged in plaintext.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Models (comma separated) *</label>
            <Input
              required
              placeholder="meta-llama/Llama-3.3-70B-Instruct, deepseek-ai/DeepSeek-V3"
              value={formData.models}
              onChange={(e) => setFormData({ ...formData, models: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Request Timeout (ms)</label>
              <Input
                type="number"
                placeholder="60000"
                value={formData.timeoutMs}
                onChange={(e) => setFormData({ ...formData, timeoutMs: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Status</label>
              <div className="flex items-center gap-2 h-10">
                <input
                  type="checkbox"
                  id="enabled-toggle"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="rounded border-black/20"
                />
                <label htmlFor="enabled-toggle" className="text-sm text-text-main cursor-pointer">
                  Enabled
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Custom Headers (safe JSON format)</label>
            <textarea
              rows={3}
              value={formData.customHeaders}
              onChange={(e) => setFormData({ ...formData, customHeaders: e.target.value })}
              className="w-full rounded-lg border border-black/10 bg-surface p-2 font-mono text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
              placeholder='{ "X-Custom-Client": "9router" }'
            />
          </div>

          {/* Test Result in Modal */}
          {testResult && (
            <div className={cn(
              "p-3 rounded-lg border text-xs font-mono",
              testResult.success
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300"
            )}>
              <div className="font-bold flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-[16px]">
                  {testResult.success ? "check_circle" : "error"}
                </span>
                {testResult.success ? "Connection Verified Successfully" : "Connection Failed"}
              </div>
              <div>Status: {testResult.status || testResult.httpStatus || (testResult.success ? 200 : "Error")}</div>
              {testResult.latencyMs != null && <div>Latency: {testResult.latencyMs}ms</div>}
              {testResult.modelsCount != null && <div>Detected Models: {testResult.modelsCount}</div>}
              {testResult.error && <div>Error: {testResult.error}</div>}
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-black/5 dark:border-white/5">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleTestConnection(formData)}
              disabled={!formData.baseUrl || testingId === "modal"}
            >
              {testingId === "modal" ? "Testing..." : "Test Connection"}
            </Button>

            <div className="flex gap-2">
              <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                {editingProvider ? "Save Changes" : "Create Provider"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
