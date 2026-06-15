"use client";

import { useCallback, useEffect, useState } from "react";

interface Settings {
  knownR: number;
  masteredR: number;
  masteredMethods: number;
  masteredMethodsHighCentrality: number;
  highCentralityThreshold: number;
  centralityWeight: number;
  difficultyWeight: number;
  connectionWeightFactor: number;
}

const FIELDS: { key: keyof Settings; label: string; hint: string; step: number }[] = [
  { key: "knownR", label: "Known R cutoff", hint: "R above which a passed item counts as known", step: 0.01 },
  { key: "masteredR", label: "Mastered R cutoff", hint: "R above which a passed item counts as mastered", step: 0.01 },
  { key: "masteredMethods", label: "Methods to master", hint: "distinct methods needed (normal item)", step: 1 },
  { key: "masteredMethodsHighCentrality", label: "Methods to master (hub)", hint: "distinct methods needed (high-centrality item)", step: 1 },
  { key: "highCentralityThreshold", label: "High-centrality threshold", hint: "normalized centrality at/above which an item is a hub", step: 0.01 },
  { key: "centralityWeight", label: "Centrality weight", hint: "how much centrality boosts mastery weight", step: 0.1 },
  { key: "difficultyWeight", label: "Difficulty weight", hint: "how much difficulty boosts mastery weight", step: 0.1 },
  { key: "connectionWeightFactor", label: "Connection weight factor", hint: "scales down connection/integration items", step: 0.05 },
];

interface DashboardCounts {
  mastery: number;
  counts: Record<string, number>;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [dash, setDash] = useState<DashboardCounts | null>(null);
  const [saved, setSaved] = useState(false);

  const loadDash = useCallback(async () => {
    const d = await (await fetch("/api/dashboard")).json();
    setDash({ mastery: d.mastery, counts: d.counts });
  }, []);

  useEffect(() => {
    (async () => {
      const s = await (await fetch("/api/settings")).json();
      setSettings(s.settings);
      setDefaults(s.defaults);
    })();
    void loadDash();
  }, [loadDash]);

  const save = async (next: Settings) => {
    setSettings(next);
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      setSaved(true);
      await loadDash(); // reflect the change immediately
      setTimeout(() => setSaved(false), 1500);
    }
  };

  if (!settings) return <p className="text-[var(--muted)]">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        {defaults && (
          <button
            onClick={() => save(defaults)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
          >
            Reset to defaults
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Thresholds and weighting are read at runtime, never hardcoded. Changes
        apply immediately — watch the live mastery readout below.
      </p>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums">
            {dash ? (dash.mastery * 100).toFixed(1) : "—"}%
          </span>
          <span className="text-sm text-[var(--muted)]">live topic mastery</span>
          {saved && <span className="text-xs text-emerald-400">saved ✓</span>}
        </div>
        {dash && (
          <div className="mt-2 flex gap-4 text-xs text-[var(--muted)]">
            {Object.entries(dash.counts).map(([k, v]) => (
              <span key={k}>
                {k}: <span className="text-[var(--text)]">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <label
            key={f.key}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="text-sm font-medium">{f.label}</div>
            <div className="text-xs text-[var(--muted)]">{f.hint}</div>
            <input
              type="number"
              step={f.step}
              value={settings[f.key]}
              onChange={(e) =>
                setSettings({ ...settings, [f.key]: Number(e.target.value) })
              }
              onBlur={() => save(settings)}
              className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
