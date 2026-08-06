import { GENERATION_PHASES } from "./stream-log";

export type GenerationRunSummary = {
  slug: string;
  name: string;
  scopeLevel: string;
  scopeDescription: string;
  status: "completed" | "failed" | "in_progress";
  /** True when a generator process pid file is present for this run. */
  isLive: boolean;
  phasesCompleted: string[];
  lastPhase: string | null;
  startedAt: string | null;
  updatedAt: string;
  eventCount: number;
  hasImport: boolean;
};

export { GENERATION_PHASES };
