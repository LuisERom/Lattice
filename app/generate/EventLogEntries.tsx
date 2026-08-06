"use client";

import { useState } from "react";
import {
  callLabel,
  formatLlmCallTitle,
  type LogEntry,
  type LlmCallEntry,
} from "@/lib/generate/stream-log";

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PayloadPanel({
  title,
  value,
  emptyHint,
}: {
  title: string;
  value: unknown;
  emptyHint: string;
}) {
  const missing = value === undefined || value === null || value === "";
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--background)]">
      <div className="border-b border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </div>
      {missing ? (
        <div className="px-2 py-2 text-[10px] text-[var(--muted)]">{emptyHint}</div>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2 py-2 text-[10px] leading-relaxed text-[var(--text)]">
          {pretty(value)}
        </pre>
      )}
    </div>
  );
}

function LlmCallRow({ entry }: { entry: LlmCallEntry }) {
  const [open, setOpen] = useState(false);
  const title = formatLlmCallTitle(entry);
  const isError = entry.state === "error";
  const isDone = entry.state === "done";
  const isWait = entry.state === "waiting";

  // Waiting ↔ prompt; done/error ↔ response.
  const prompt =
    isWait || isError
      ? entry.request?.messages ?? entry.request
      : undefined;
  const response = isDone || isError ? entry.response : undefined;
  const raw = isDone || isError ? entry.raw : undefined;
  const error = isError ? entry.error : undefined;

  const hasPayload =
    (isWait && prompt !== undefined) ||
    (isDone && (response !== undefined || raw !== undefined)) ||
    (isError && (error !== undefined || response !== undefined || prompt !== undefined));

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-start gap-1.5 px-0.5 py-1 text-left hover:bg-[var(--surface-2)] ${
          isError
            ? "text-rose-400"
            : isDone
              ? "text-emerald-400"
              : isWait
                ? "text-amber-300"
                : "text-[var(--muted)]"
        }`}
      >
        <span className="mt-px w-3 shrink-0 text-[var(--muted)]">{open ? "▼" : "▶"}</span>
        <span className="min-w-0 flex-1 break-words">{title}</span>
      </button>
      {open && (
        <div className="mb-1.5 ml-4 space-y-1.5">
          <div className="text-[10px] text-[var(--muted)]">
            {callLabel(entry.label)}
            {entry.model ? ` · ${entry.model}` : ""}
            {entry.callId ? ` · id ${entry.callId}` : ""}
          </div>
          {!hasPayload && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
              {isWait
                ? "Prompt was not recorded for this call. New generation runs capture it."
                : "Response was not recorded for this call. New generation runs capture it."}
            </div>
          )}
          {isWait && (
            <PayloadPanel
              title="Prompt sent to LLM"
              value={prompt}
              emptyHint="No prompt recorded."
            />
          )}
          {isDone && (
            <>
              <PayloadPanel
                title="Response from LLM"
                value={response}
                emptyHint="No response recorded."
              />
              {raw !== undefined && (
                <PayloadPanel
                  title="Raw response text"
                  value={raw}
                  emptyHint="No raw response recorded."
                />
              )}
            </>
          )}
          {isError && (
            <>
              {prompt !== undefined && (
                <PayloadPanel
                  title="Prompt sent to LLM"
                  value={prompt}
                  emptyHint="No prompt recorded."
                />
              )}
              <PayloadPanel title="Error" value={error} emptyHint="No error detail recorded." />
              {response !== undefined && (
                <PayloadPanel
                  title="Response from LLM"
                  value={response}
                  emptyHint="No response recorded."
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TextRow({ text }: { text: string }) {
  const isPhase = text.startsWith("▶");
  const isDone = text.startsWith("✓");
  const isError = text.startsWith("✗");
  const isWait = text.startsWith("⏳");
  return (
    <div
      className={`border-b border-[var(--border)] py-0.5 last:border-b-0 ${
        isError
          ? "text-rose-400"
          : isDone
            ? "text-emerald-400"
            : isWait
              ? "text-amber-300"
              : isPhase
                ? "text-sky-300 font-semibold"
                : "text-[var(--muted)]"
      }`}
    >
      {text}
    </div>
  );
}

export default function EventLogEntries({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-[var(--muted)]">No events recorded for this phase.</div>;
  }
  return (
    <>
      {entries.map((entry, i) =>
        entry.kind === "llm_call" ? (
          <LlmCallRow key={`${entry.callId}-${entry.state}-${i}`} entry={entry} />
        ) : (
          <TextRow key={`${i}-${entry.text.slice(0, 24)}`} text={entry.text} />
        )
      )}
    </>
  );
}
