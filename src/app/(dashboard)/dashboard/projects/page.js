"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Modal, Select, Toggle } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    defaultModel: "auto",
    routingMode: "balanced",
    allowedProviders: "",
    allowedModels: "",
    fallbackSequence: "",
    timeoutMs: "",
    usageLimit: "",
  });

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setProjects(data.projects || []);
        }
      })
      .catch((err) => {
        console.error("Failed to load projects:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleOpenCreate = () => {
    setEditingProject(null);
    setFormData({
      name: "",
      description: "",
      defaultModel: "auto",
      routingMode: "balanced",
      allowedProviders: "",
      allowedModels: "",
      fallbackSequence: "",
      timeoutMs: "",
      usageLimit: "",
    });
    setShowModal(true);
  };

  const handleOpenEdit = (proj) => {
    setEditingProject(proj);
    setFormData({
      name: proj.name,
      description: proj.description || "",
      defaultModel: proj.defaultModel || "auto",
      routingMode: proj.routingMode || "balanced",
      allowedProviders: (proj.allowedProviders || []).join(", "),
      allowedModels: (proj.allowedModels || []).join(", "),
      fallbackSequence: (proj.fallbackSequence || []).join(", "),
      timeoutMs: proj.timeoutMs != null ? String(proj.timeoutMs) : "",
      usageLimit: proj.usageLimit != null ? String(proj.usageLimit) : "",
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this project? Bound API keys will be unlinked.")) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchProjects();
      }
    } catch (err) {
      console.error("Delete project failed:", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: formData.name,
      description: formData.description,
      defaultModel: formData.defaultModel || "auto",
      routingMode: formData.routingMode || "balanced",
      allowedProviders: formData.allowedProviders ? formData.allowedProviders.split(",").map((s) => s.trim()).filter(Boolean) : [],
      allowedModels: formData.allowedModels ? formData.allowedModels.split(",").map((s) => s.trim()).filter(Boolean) : [],
      fallbackSequence: formData.fallbackSequence ? formData.fallbackSequence.split(",").map((s) => s.trim()).filter(Boolean) : [],
      timeoutMs: formData.timeoutMs ? Number(formData.timeoutMs) : null,
      usageLimit: formData.usageLimit ? Number(formData.usageLimit) : null,
    };

    try {
      const url = editingProject ? `/api/projects/${editingProject.id}` : "/api/projects";
      const method = editingProject ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowModal(false);
        await fetchProjects();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save project");
      }
    } catch (err) {
      console.error("Save project failed:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-2xl text-primary">folder_special</span>
            <h1 className="text-2xl font-bold text-text-main">Projects & Routing Profiles</h1>
          </div>
          <p className="text-sm text-text-muted">
            Configure reusable routing profiles with custom fallback sequences, provider restrictions, and spend caps.
          </p>
        </div>

        <Button variant="primary" onClick={handleOpenCreate} className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">add</span>
          New Project Profile
        </Button>
      </div>

      {/* Projects List */}
      {loading ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted flex items-center justify-center gap-2">
            <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            Loading projects...
          </div>
        </Card>
      ) : projects.length === 0 ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted">
            No projects configured yet. Click &quot;New Project Profile&quot; to create one.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => (
            <Card key={proj.id} padding="md" className="flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                      {proj.name}
                      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono font-normal uppercase">
                        {proj.routingMode || "balanced"}
                      </span>
                    </h3>
                    {proj.description && (
                      <p className="text-xs text-text-muted mt-1">{proj.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(proj)}>
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(proj.id)}>
                      <span className="material-symbols-outlined text-[16px] text-rose-500">delete</span>
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-black/[0.02] dark:bg-white/[0.02] p-3 rounded-lg border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-text-muted block">Default Model:</span>
                    <span className="font-mono font-medium text-text-main">{proj.defaultModel || "auto"}</span>
                  </div>

                  <div>
                    <span className="text-text-muted block">Timeout:</span>
                    <span className="font-mono text-text-main">{proj.timeoutMs ? `${proj.timeoutMs}ms` : "Default"}</span>
                  </div>

                  <div>
                    <span className="text-text-muted block">Current Spend:</span>
                    <span className="font-mono font-medium text-text-main">${(proj.currentSpend || 0).toFixed(4)}</span>
                  </div>

                  <div>
                    <span className="text-text-muted block">Budget Cap:</span>
                    <span className="font-mono text-text-main">{proj.usageLimit ? `$${proj.usageLimit}` : "Unlimited"}</span>
                  </div>
                </div>

                {/* Ordered Fallback Sequence */}
                {proj.fallbackSequence && proj.fallbackSequence.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-text-muted block mb-1">Fallback Sequence:</span>
                    <div className="flex flex-wrap gap-1">
                      {proj.fallbackSequence.map((fb, idx) => (
                        <span key={idx} className="text-xs font-mono px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center gap-1">
                          <span className="text-text-muted text-[10px]">{idx + 1}.</span> {fb}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between text-xs text-text-muted">
                <span>ID: <code className="font-mono">{proj.id.slice(0, 8)}...</code></span>
                <span className="text-emerald-600 font-medium">✓ Active</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingProject ? "Edit Project Profile" : "Create Project Profile"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Project Name *</label>
            <Input
              required
              placeholder="e.g. Tern CLI, Website Backend"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Description</label>
            <Input
              placeholder="e.g. Autonomous agent task routing"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Default Model / Router</label>
              <Input
                placeholder="auto/balanced"
                value={formData.defaultModel}
                onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Routing Mode</label>
              <select
                value={formData.routingMode}
                onChange={(e) => setFormData({ ...formData, routingMode: e.target.value })}
                className="h-10 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main dark:border-white/10"
              >
                <option value="balanced">Balanced</option>
                <option value="fast">Fast</option>
                <option value="cheap">Cheap</option>
                <option value="quality">Quality</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Ordered Fallback Sequence (comma separated)</label>
            <Input
              placeholder="claude-3-5-sonnet, gpt-4o, gemini-2.5-flash"
              value={formData.fallbackSequence}
              onChange={(e) => setFormData({ ...formData, fallbackSequence: e.target.value })}
            />
            <p className="text-[11px] text-text-muted">If primary model fails, the request automatically tries these models in order.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-main">Allowed Providers (optional, comma separated)</label>
            <Input
              placeholder="anthropic, openai, gemini"
              value={formData.allowedProviders}
              onChange={(e) => setFormData({ ...formData, allowedProviders: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Timeout (ms)</label>
              <Input
                type="number"
                placeholder="e.g. 60000"
                value={formData.timeoutMs}
                onChange={(e) => setFormData({ ...formData, timeoutMs: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-main">Budget Cap ($ USD)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 50.00"
                value={formData.usageLimit}
                onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              {editingProject ? "Update Profile" : "Create Profile"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
