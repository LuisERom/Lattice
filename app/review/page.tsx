"use client";

import { useCallback, useEffect, useState } from "react";

interface NextResponse {
  done: boolean;
  remainingDue?: number;
  item?: { id: number; kind: string };
  nodeNames?: string[];
  method?: string;
  question?: {
    id: number;
    method: string;
    prompt: string;
    expected_answer: string;
    options: string[] | null;
  };
  retrievabilityBefore?: number;
  due?: string;
  state?: number;
}

const RATINGS = [
  { value: 1, label: "Again", hint: "forgot", className: "bg-red-500/20 hover:bg-red-500/30 border-red-500/40" },
  { value: 2, label: "Hard", hint: "barely", className: "bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40" },
  { value: 3, label: "Good", hint: "recalled", className: "bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40" },
  { value: 4, label: "Easy", hint: "instant", className: "bg-sky-500/20 hover:bg-sky-500/30 border-sky-500/40" },
];

const METHOD_LABELS: Record<string, string> = {
  cloze: "Cloze",
  free_recall: "Free recall",
  application: "Application",
  relational: "Relational",
  recognition: "Recognition",
};

export default function ReviewPage() {
  const [card, setCard] = useState<NextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setRevealed(false);
    setAnswer("");
    const res = await fetch("/api/review/next");
    const data = (await res.json()) as NextResponse;
    setCard(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadNext();
  }, [loadNext]);

  const rate = async (rating: number) => {
    if (!card?.item || !card.question) return;
    const res = await fetch("/api/review/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: card.item.id,
        method: card.question.method,
        rating,
        userAnswer: answer,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      const fmt = (d: string) => new Date(d).toLocaleString();
      setLastResult(
        `Updated: stability ${data.before.stability.toFixed(2)} → ${data.after.stability.toFixed(
          2
        )}, next due ${fmt(data.after.due)}`
      );
    }
    await loadNext();
  };

  if (loading && !card) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  if (card?.done) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Review</h1>
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-lg">All caught up.</p>
          <p className="mt-1 text-[var(--muted)]">No items are due right now.</p>
          {lastResult && (
            <p className="mt-4 text-xs text-[var(--muted)]">{lastResult}</p>
          )}
        </div>
      </div>
    );
  }

  const q = card?.question;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Review</h1>
        <span className="text-sm text-[var(--muted)]">
          {card?.remainingDue} due
        </span>
      </div>

      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[var(--accent)]">
            {METHOD_LABELS[q?.method ?? ""] ?? q?.method}
          </span>
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[var(--muted)]">
            {card?.item?.kind}
          </span>
          {card?.nodeNames?.map((n) => (
            <span
              key={n}
              className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[var(--muted)]"
            >
              {n}
            </span>
          ))}
        </div>

        <p className="mt-4 text-lg leading-relaxed">{q?.prompt}</p>

        {q?.options && (
          <ul className="mt-3 list-inside list-disc text-[var(--muted)]">
            {q.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        )}

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer (optional, encouraged)…"
          className="mt-4 h-28 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none focus:border-[var(--accent)]"
        />

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="mt-4 rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
          >
            Reveal expected answer
          </button>
        ) : (
          <div className="mt-4">
            <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Expected answer
              </p>
              <p className="mt-1 leading-relaxed">{q?.expected_answer}</p>
            </div>
            <p className="mt-4 text-sm text-[var(--muted)]">
              How did you do? Rate yourself honestly.
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => rate(r.value)}
                  className={`rounded-md border px-3 py-3 text-sm font-medium ${r.className}`}
                >
                  <div>{r.label}</div>
                  <div className="text-xs font-normal opacity-70">{r.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {lastResult && (
        <p className="mt-4 text-xs text-[var(--muted)]">{lastResult}</p>
      )}
    </div>
  );
}
