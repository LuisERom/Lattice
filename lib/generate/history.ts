import { GENERATION_PHASES } from "./stream-log";

export type GenerationRunSummary = {
  slug: string;
  name: string;
  scopeLevel: string;
  scopeDescription: string;
  status: "completed" | "failed" | "in_progress";
  phasesCompleted: string[];
  lastPhase: string | null;
  startedAt: string | null;
  updatedAt: string;
  eventCount: number;
  hasImport: boolean;
};

export { GENERATION_PHASES };
