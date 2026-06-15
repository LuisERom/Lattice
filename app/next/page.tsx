import Link from "next/link";
import { getDb } from "@/lib/db";
import { getWhatToLearnNext } from "@/lib/sequencing";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  locked: "#4b5563",
  learning: "#f59e0b",
  known: "#3b82f6",
  mastered: "#22c55e",
};

export default function NextPage() {
  const { due, frontier } = getWhatToLearnNext(getDb());

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">What to learn next</h1>
        {due.length > 0 && (
          <Link
            href="/review"
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/20"
          >
            Review {due.length} due
          </Link>
        )}
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--muted)]">
          Due reviews ({due.length})
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Items you have learned whose retrievability has dropped. Do these first.
        </p>
        <ul className="mt-2 space-y-2">
          {due.map((d) => (
            <li
              key={d.itemId}
              className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2"
            >
              <div>
                <span className="text-sm">{d.nodeNames.join(" + ")}</span>
                <span className="ml-2 text-xs text-[var(--muted)]">{d.kind}</span>
              </div>
              <span
                className="text-xs"
                style={{ color: STATUS_COLOR[d.status] }}
              >
                {d.status}
              </span>
            </li>
          ))}
          {due.length === 0 && (
            <li className="text-sm text-[var(--muted)]">Nothing due right now.</li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--muted)]">
          Frontier ({frontier.length})
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Unlearned concepts whose prerequisites are all known, highest-centrality
          first (these unlock the most). Locked concepts are never shown.
        </p>
        <ol className="mt-2 space-y-2">
          {frontier.map((f, i) => (
            <li
              key={f.nodeId}
              className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)]">{i + 1}</span>
                <span className="text-sm">{f.name}</span>
              </div>
              <span className="text-xs text-[var(--muted)]">
                centrality {f.centrality.toFixed(2)} · difficulty {f.difficulty}
              </span>
            </li>
          ))}
          {frontier.length === 0 && (
            <li className="text-sm text-[var(--muted)]">
              No frontier concepts available.
            </li>
          )}
        </ol>
      </section>
    </div>
  );
}
