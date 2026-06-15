import Link from "next/link";
import { getDb } from "@/lib/db";
import { getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  locked: "#4b5563",
  learning: "#f59e0b",
  known: "#3b82f6",
  mastered: "#22c55e",
};

export default function DashboardPage() {
  const data = getDashboard(getDb());

  if (!data.topic) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-4 text-[var(--muted)]">
          No topic imported yet. Run <code>npm run import</code> to load the seed
          topic, then refresh.
        </p>
      </div>
    );
  }

  const masteryPct = (data.mastery * 100).toFixed(1);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href="/review"
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-[var(--accent)] hover:bg-[var(--accent)]/20"
          >
            Start review
          </Link>
          <Link
            href="/next"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)]"
          >
            What to learn next
          </Link>
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--muted)]">{data.topic.name}</p>
        <div className="mt-2 flex items-end gap-3">
          <span className="text-5xl font-semibold tabular-nums">{masteryPct}%</span>
          <span className="pb-2 text-sm text-[var(--muted)]">topic mastery</span>
        </div>
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${data.mastery * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Honest by construction: reaches 100% only over the frozen map, drifts
          down on its own as retrievability decays, jumps only when you merge new
          nodes.
        </p>
      </section>

      <section className="mt-4 grid grid-cols-4 gap-3">
        {(["locked", "learning", "known", "mastered"] as const).map((s) => (
          <div
            key={s}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: STATUS_COLOR[s] }}
              />
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                {s}
              </span>
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {data.counts[s]}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold">Coverage</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Coverage is a status, not a fake percentage (the true denominator is
          unknowable).
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-[var(--muted)]">Scope level</dt>
            <dd className="mt-0.5">{data.coverage.scopeLevel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--muted)]">Node count</dt>
            <dd className="mt-0.5">{data.coverage.nodeCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--muted)]">Last gap-search</dt>
            <dd className="mt-0.5">{data.coverage.gapSearch}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
