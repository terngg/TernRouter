"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_CONFIGS = {
  healthy: {
    label: "Healthy",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    icon: "check_circle",
  },
  slow: {
    label: "Slow Latency",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
    icon: "speed",
  },
  rate_limited: {
    label: "Rate Limited",
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
    icon: "timelapse",
  },
  quota_low: {
    label: "Low Quota",
    badgeClass: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    icon: "warning",
  },
  quota_exhausted: {
    label: "Quota Exhausted",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
    icon: "block",
  },
  auth_failed: {
    label: "Auth Failed",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
    icon: "lock_open",
  },
  timeout: {
    label: "Timeout",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
    icon: "hourglass_bottom",
  },
  provider_error: {
    label: "Provider Error",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
    icon: "error",
  },
  disabled: {
    label: "Disabled",
    badgeClass: "bg-neutral-500/15 text-neutral-500 border-neutral-500/20",
    icon: "do_not_disturb_on",
  },
  unknown: {
    label: "Untested",
    badgeClass: "bg-neutral-500/15 text-neutral-500 border-neutral-500/20",
    icon: "help_outline",
  },
};

export default function ProviderHealthPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [testingKeys, setTestingKeys] = useState(new Set());
  const [lastCheckTime, setLastCheckTime] = useState(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health/providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
        setLastCheckTime(new Date());
      }
    } catch (err) {
      console.error("Failed to load provider health:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/health/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setProviders(data.providers || []);
          setLastCheckTime(new Date());
        }
      })
      .catch((err) => {
        console.error("Failed to load provider health:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleTestAll = async () => {
    setTestingAll(true);
    try {
      const res = await fetch("/api/health/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchHealth();
      }
    } catch (err) {
      console.error("Test all failed:", err);
    } finally {
      setTestingAll(false);
    }
  };

  const handleTestSingle = async (provider, model, connectionId) => {
    const key = `${provider}/${model}/${connectionId || "default"}`;
    setTestingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/health/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, connectionId }),
      });
      if (res.ok) {
        await fetchHealth();
      }
    } catch (err) {
      console.error(`Test ${key} failed:`, err);
    } finally {
      setTestingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 p-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-2xl text-primary">monitor_heart</span>
            <h1 className="text-2xl font-bold text-text-main">Provider & Model Health</h1>
          </div>
          <p className="text-sm text-text-muted">
            Live health verification, latency probes, rate limit tracking, and quota monitoring for all connected providers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={handleTestAll}
            disabled={testingAll || loading}
            className="flex items-center gap-2"
          >
            <span className={cn("material-symbols-outlined text-[18px]", testingAll && "animate-spin")}>
              {testingAll ? "progress_activity" : "bolt"}
            </span>
            {testingAll ? "Testing All Models..." : "Test All Models"}
          </Button>

          <Button variant="ghost" onClick={fetchHealth} disabled={loading}>
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </Button>
        </div>
      </div>

      {/* Info notice bar */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-primary">verified_user</span>
          <span>Zero-Quota-Burn Health Checks: Lightweight model probes with 30-second cooldown & concurrency limits (3 workers).</span>
        </div>
        {lastCheckTime && (
          <div>Last checked: {lastCheckTime.toLocaleTimeString()}</div>
        )}
      </div>

      {/* Providers Grid */}
      {loading ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted flex items-center justify-center gap-2">
            <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            Loading provider health data...
          </div>
        </Card>
      ) : providers.length === 0 ? (
        <Card padding="md">
          <div className="p-8 text-center text-text-muted">
            No active providers or connections configured yet. Connect a provider in the Providers tab.
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {providers.map((p) => {
            return (
              <Card key={p.provider} padding="none">
                <div className="p-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-black/[0.01] dark:bg-white/[0.01]">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-base text-text-main capitalize">{p.name || p.provider}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono text-text-muted">
                      {p.accounts?.length || 0} account{p.accounts?.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (p.models && p.models[0]) {
                        handleTestSingle(p.provider, p.models[0].model, p.models[0].connectionId);
                      }
                    }}
                    disabled={testingAll}
                  >
                    Test Provider
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-black/5 dark:border-white/5 text-[11px] uppercase tracking-wider text-text-muted">
                        <th className="p-3 text-left">Model</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-left">Health Status</th>
                        <th className="p-3 text-right">Latency</th>
                        <th className="p-3 text-left">Last Tested</th>
                        <th className="p-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!p.models || p.models.length === 0) ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-xs text-text-muted">
                            No models discovered for this provider
                          </td>
                        </tr>
                      ) : (
                        p.models.map((m, idx) => {
                          const stateKey = m.status || "unknown";
                          const cfg = STATUS_CONFIGS[stateKey] || STATUS_CONFIGS.unknown;
                          const isTesting = testingKeys.has(`${p.provider}/${m.model}/${m.connectionId || "default"}`) || testingAll;

                          return (
                            <tr
                              key={`${m.model}-${idx}`}
                              className="border-b border-black/5 last:border-b-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
                            >
                              <td className="p-3 text-sm font-mono font-medium text-text-main">
                                {m.model}
                              </td>

                              <td className="p-3 text-xs text-text-muted">
                                <span className="font-mono bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded">
                                  {m.connectionName || (m.connectionId ? m.connectionId.slice(0, 8) : "default")}
                                </span>
                              </td>

                              <td className="p-3">
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border w-fit",
                                      cfg.badgeClass
                                    )}
                                  >
                                    <span className="material-symbols-outlined text-[14px]">{cfg.icon}</span>
                                    {cfg.label}
                                  </span>
                                  {m.error && (
                                    <span className="text-[11px] text-rose-500 font-mono mt-0.5 max-w-[280px] truncate" title={m.error}>
                                      {m.error}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="p-3 text-right text-xs font-mono">
                                {m.latencyMs ? (
                                  <span className={cn(
                                    "font-semibold",
                                    m.latencyMs < 1000 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                                  )}>
                                    {m.latencyMs >= 1000 ? `${(m.latencyMs / 1000).toFixed(2)}s` : `${m.latencyMs}ms`}
                                  </span>
                                ) : (
                                  <span className="text-text-muted">—</span>
                                )}
                              </td>

                              <td className="p-3 text-xs text-text-muted whitespace-nowrap">
                                {m.lastTested ? new Date(m.lastTested).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Never"}
                              </td>

                              <td className="p-3 text-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleTestSingle(p.provider, m.model, m.connectionId)}
                                  disabled={isTesting}
                                  className="h-7 text-xs px-2.5"
                                >
                                  {isTesting ? (
                                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                                  ) : (
                                    "Test Again"
                                  )}
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
