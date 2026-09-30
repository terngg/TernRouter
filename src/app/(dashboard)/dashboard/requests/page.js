"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Select, Badge } from "@/shared/components";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";

export default function RequestInspectorPage() {
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [projects, setProjects] = useState([]);

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });

  const [filters, setFilters] = useState({
    provider: "",
    model: "",
    status: "",
    errorCategory: "",
    projectId: "",
    apiKeyId: "",
    startDate: "",
    endDate: "",
  });

  const fetchProvidersAndProjects = useCallback(async () => {
    try {
      const [provRes, projRes] = await Promise.all([
        fetch("/api/usage/providers").catch(() => null),
        fetch("/api/projects").catch(() => null),
      ]);
      if (provRes && provRes.ok) {
        const provData = await provRes.json();
        setProviders(provData.providers || []);
      }
      if (projRes && projRes.ok) {
        const projData = await projRes.json();
        setProjects(projData.projects || []);
      }
    } catch (err) {
      console.error("Failed to load filter metadata:", err);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.model) params.append("model", filters.model);
      if (filters.status) params.append("status", filters.status);
      if (filters.errorCategory) params.append("errorCategory", filters.errorCategory);
      if (filters.projectId) params.append("projectId", filters.projectId);
      if (filters.apiKeyId) params.append("apiKeyId", filters.apiKeyId);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDetails(data.details || []);
        if (data.pagination) {
          setPagination((prev) => ({ ...prev, ...data.pagination }));
        }
      }
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/usage/providers").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([provData, projData]) => {
      if (active) {
        if (provData) setProviders(provData.providers || []);
        if (projData) setProjects(projData.projects || []);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      page: pagination.page.toString(),
      pageSize: pagination.pageSize.toString(),
    });
    if (filters.provider) params.append("provider", filters.provider);
    if (filters.model) params.append("model", filters.model);
    if (filters.status) params.append("status", filters.status);
    if (filters.errorCategory) params.append("errorCategory", filters.errorCategory);
    if (filters.projectId) params.append("projectId", filters.projectId);
    if (filters.apiKeyId) params.append("apiKeyId", filters.apiKeyId);
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);

    fetch(`/api/usage/request-details?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setDetails(data.details || []);
          if (data.pagination) {
            setPagination((prev) => ({ ...prev, ...data.pagination }));
          }
        }
      })
      .catch((error) => {
        console.error("Failed to fetch request details:", error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pagination.page, pagination.pageSize, filters]);

  const handleClearFilters = () => {
    setFilters({
      provider: "",
      model: "",
      status: "",
      errorCategory: "",
      projectId: "",
      apiKeyId: "",
      startDate: "",
      endDate: "",
    });
  };

  const handleOpenDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-2xl text-primary">manage_search</span>
          <h1 className="text-2xl font-bold text-text-main">AI Request Inspector</h1>
        </div>
        <p className="text-sm text-text-muted">
          Inspect end-to-end request pipelines, auto-routing decisions, fallback attempts, latencies, and token analytics.
        </p>
      </div>

      {/* Filter Card */}
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Provider</label>
            <select
              value={filters.provider}
              onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            >
              <option value="">All Providers</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Model</label>
            <input
              type="text"
              placeholder="e.g. auto, claude-3-5..."
              value={filters.model}
              onChange={(e) => setFilters({ ...filters, model: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Error Category</label>
            <select
              value={filters.errorCategory}
              onChange={(e) => setFilters({ ...filters, errorCategory: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            >
              <option value="">All Categories</option>
              <option value="rate_limit">Rate Limit (429)</option>
              <option value="quota_exhausted">Quota Exhausted</option>
              <option value="timeout">Timeout / Stall</option>
              <option value="auth_failure">Auth Failure</option>
              <option value="server_error">Server Error (5xx)</option>
              <option value="permission_denied">Permission Denied</option>
              <option value="bad_request">Bad Request (400)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Project</label>
            <select
              value={filters.projectId}
              onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            >
              <option value="">All Projects</option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Start Date</label>
            <input
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">End Date</label>
            <input
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="h-9 w-full rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            />
          </div>

          <div className="flex items-end">
            <Button variant="ghost" onClick={handleClearFilters} className="w-full">
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Requests Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Timestamp</th>
                <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Requested / Selected</th>
                <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Routing Visualization</th>
                <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">Status</th>
                <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Tokens</th>
                <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Latency</th>
                <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">Inspect</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading requests...
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-text-muted">
                    No requests found matching criteria
                  </td>
                </tr>
              ) : (
                details.map((detail, idx) => {
                  const isSuccess = detail.status === "success" || detail.httpStatus === 200;
                  const inTok = detail.tokens?.prompt_tokens || detail.tokens?.input_tokens || 0;
                  const outTok = detail.tokens?.completion_tokens || detail.tokens?.output_tokens || 0;
                  const cachedTok = detail.tokens?.cached_tokens || 0;
                  const retryCount = detail.retryCount || (detail.routingTrace ? Math.max(0, detail.routingTrace.length - 1) : 0);

                  return (
                    <tr
                      key={`${detail.id}-${idx}`}
                      className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
                    >
                      <td className="whitespace-nowrap p-4 text-xs font-mono text-text-muted">
                        {new Date(detail.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <div className="text-[11px] text-text-muted/60">{new Date(detail.timestamp).toLocaleDateString()}</div>
                      </td>

                      <td className="p-4 text-sm">
                        <div className="font-mono font-medium text-text-main">
                          {detail.requestedModel || detail.model}
                        </div>
                        {detail.selectedModel && detail.selectedModel !== detail.requestedModel && (
                          <div className="text-xs text-primary font-mono flex items-center gap-1 mt-0.5">
                            <span className="material-symbols-outlined text-[13px]">subdirectory_arrow_right</span>
                            {detail.selectedModel}
                          </div>
                        )}
                        {detail.routingMode && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary uppercase">
                            {detail.routingMode}
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-xs max-w-[340px]">
                        {detail.routeVisualization ? (
                          <div className="font-mono text-xs text-text-main bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded border border-black/5 dark:border-white/5 break-all">
                            {detail.routeVisualization}
                          </div>
                        ) : (
                          <span className="text-text-muted font-mono">{detail.provider}/{detail.model}</span>
                        )}
                        {retryCount > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <span className="material-symbols-outlined text-[13px]">refresh</span>
                            <span>{retryCount} fallback attempt{retryCount > 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                            isSuccess
                              ? "bg-green-500/15 text-green-600 dark:text-green-400"
                              : "bg-red-500/15 text-red-600 dark:text-red-400"
                          )}
                        >
                          {isSuccess ? "200 OK" : `${detail.httpStatus || 500} ${detail.errorCategory || "Error"}`}
                        </span>
                      </td>

                      <td className="p-4 text-right font-mono text-xs text-text-main whitespace-nowrap">
                        <div>IN: {inTok.toLocaleString()}</div>
                        {cachedTok > 0 && <div className="text-[11px] text-primary">↻ {cachedTok.toLocaleString()}</div>}
                        <div>OUT: {outTok.toLocaleString()}</div>
                      </td>

                      <td className="p-4 text-right font-mono text-xs text-text-muted whitespace-nowrap">
                        <div className="text-text-main font-medium">{detail.latency?.total || detail.totalDuration || 0}ms</div>
                        {detail.latency?.ttft > 0 && <div className="text-[11px]">TTFT {detail.latency.ttft}ms</div>}
                      </td>

                      <td className="p-4 text-center">
                        <Button variant="outline" size="sm" onClick={() => handleOpenDetail(detail)}>
                          View Trace
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5 p-2">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={(p) => setPagination((prev) => ({ ...prev, page: p }))}
              onPageSizeChange={(ps) => setPagination((prev) => ({ ...prev, pageSize: ps, page: 1 }))}
            />
          </div>
        )}
      </Card>

      {/* Trace Inspector Drawer */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="AI Request Inspector & Trace"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            {/* Overview Grid */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-black/5 bg-black/[0.02] p-4 text-xs dark:border-white/5 dark:bg-white/[0.02]">
              <div>
                <span className="text-text-muted">Request ID:</span>{" "}
                <span className="font-mono text-text-main break-all">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-text-muted">Requested Model:</span>{" "}
                <span className="font-mono font-medium text-text-main">{selectedDetail.requestedModel || selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Selected Model:</span>{" "}
                <span className="font-mono text-primary font-medium">{selectedDetail.selectedModel || selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Routing Mode:</span>{" "}
                <span className="font-medium uppercase text-text-main">{selectedDetail.routingMode || "Direct"}</span>
              </div>
              <div>
                <span className="text-text-muted">Streamed:</span>{" "}
                <span className="text-text-main font-medium">{selectedDetail.streamed ? "Yes (SSE)" : "No (JSON)"}</span>
              </div>
              <div>
                <span className="text-text-muted">API Key:</span>{" "}
                <span className="font-mono text-text-main">{selectedDetail.apiKeyId || "Master / Local"}</span>
              </div>
              <div>
                <span className="text-text-muted">Project:</span>{" "}
                <span className="font-medium text-text-main">{selectedDetail.projectId || "Default"}</span>
              </div>
            </div>

            {/* Route Timeline */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">alt_route</span>
                Complete Routing Pipeline
              </h3>

              {selectedDetail.routeVisualization && (
                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 text-xs font-mono text-text-main">
                  {selectedDetail.routeVisualization}
                </div>
              )}

              {/* Hop Timeline */}
              {selectedDetail.routingTrace && selectedDetail.routingTrace.length > 0 ? (
                <div className="space-y-2">
                  {selectedDetail.routingTrace.map((attempt, i) => (
                    <div
                      key={i}
                      className={cn(
                        "p-3 rounded-lg border text-xs font-mono flex items-center justify-between",
                        attempt.success || attempt.status === 200
                          ? "border-green-500/20 bg-green-500/5 text-text-main"
                          : "border-amber-500/20 bg-amber-500/5 text-text-main"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                          attempt.success || attempt.status === 200
                            ? "bg-green-500 text-white"
                            : "bg-amber-500 text-white"
                        )}>
                          {attempt.attempt || i + 1}
                        </span>
                        <div>
                          <span className="font-semibold">{attempt.provider}/{attempt.model}</span>
                          <span className="text-text-muted ml-2">acc: {attempt.connectionName || attempt.connectionId?.slice(0, 8) || "default"}</span>
                          {attempt.reason && <div className="text-[11px] text-text-muted mt-0.5">{attempt.reason}</div>}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={cn(
                          "font-bold",
                          attempt.success || attempt.status === 200 ? "text-green-600" : "text-amber-600"
                        )}>
                          {attempt.success || attempt.status === 200 ? "✓ Success" : `✕ ${attempt.status || attempt.errorCategory || "Failed"}`}
                        </span>
                        {attempt.duration > 0 && <div className="text-[10px] text-text-muted">{attempt.duration}ms</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-text-muted italic">Direct routing to {selectedDetail.provider}/{selectedDetail.model}</div>
              )}
            </div>

            {/* Latency & Tokens Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-black/5 dark:border-white/5 bg-surface">
                <span className="text-text-muted block mb-1">Latency</span>
                <div className="font-mono text-sm font-semibold text-text-main">
                  Total: {selectedDetail.latency?.total || selectedDetail.totalDuration || 0}ms
                </div>
                <div className="font-mono text-text-muted text-[11px]">
                  TTFT: {selectedDetail.latency?.ttft || 0}ms
                </div>
              </div>

              <div className="p-3 rounded-lg border border-black/5 dark:border-white/5 bg-surface">
                <span className="text-text-muted block mb-1">Tokens</span>
                <div className="font-mono text-sm font-semibold text-text-main">
                  {(selectedDetail.tokens?.prompt_tokens || 0) + (selectedDetail.tokens?.completion_tokens || 0)} Total
                </div>
                <div className="font-mono text-text-muted text-[11px]">
                  In: {selectedDetail.tokens?.prompt_tokens || 0} · Out: {selectedDetail.tokens?.completion_tokens || 0}
                </div>
              </div>
            </div>

            {/* Privacy Notice */}
            <div className="p-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 text-[11px] text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">security</span>
              <span>
                Zero Token Leakage Guarantee: User prompts, completion messages, and upstream provider credentials are fully redacted from dashboard storage to protect privacy.
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
