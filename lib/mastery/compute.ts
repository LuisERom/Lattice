// Pure status / mastery / weighting math (Doc 1, Sections 7.1–7.3). Kept free of
// any DB access so it can be unit-tested directly (Doc 3, Section 7). All
// thresholds and weights come from Settings, never hardcoded (Invariant 10).
import type { Settings } from "../settings";
import type { ItemKind } from "../types";

export type ItemStatus = "locked" | "learning" | "known" | "mastered";

export interface ItemStatusInput {
  /** True if any prerequisite/member gate is unmet. */
  locked: boolean;
  /** Distinct methods that have ever been passed for this item. */
  distinctMethodsPassed: number;
  /** Current retrievability (0..1); 0 for never-reviewed items. */
  R: number;
  /** True if the item's member nodes make it high-centrality. */
  isHighCentrality: boolean;
  settings: Settings;
}

export function itemStatus(input: ItemStatusInput): ItemStatus {
  if (input.locked) return "locked";

  const everPassed = input.distinctMethodsPassed >= 1;
  if (!everPassed) return "learning";

  const required = input.isHighCentrality
    ? input.settings.masteredMethodsHighCentrality
    : input.settings.masteredMethods;

  if (
    input.distinctMethodsPassed >= required &&
    input.R >= input.settings.masteredR
  ) {
    return "mastered";
  }
  if (input.R >= input.settings.knownR) return "known";
  // Passed before but retrievability has decayed below the known cutoff.
  return "learning";
}

/** A status that counts as "known" for unlocking dependents (Doc 7.2). */
export function countsAsKnown(status: ItemStatus): boolean {
  return status === "known" || status === "mastered";
}

/**
 * Per-item weight for the topic-mastery average. A tunable function of the
 * centrality and difficulty of the item's member nodes. Connection and
 * integration items are scaled down so they enrich without dominating (7.3/7.5).
 *
 * `centralityAgg` is 0..1; `difficultyNormAgg` is 0..1 (difficulty normalized
 * across the topic). Both are the aggregate (max) over member nodes.
 */
export function itemWeight(
  kind: ItemKind,
  centralityAgg: number,
  difficultyNormAgg: number,
  settings: Settings
): number {
  const base =
    (1 + settings.centralityWeight * centralityAgg) *
    (1 + settings.difficultyWeight * difficultyNormAgg);
  const factor =
    kind === "connection" || kind === "integration"
      ? settings.connectionWeightFactor
      : 1;
  return base * factor;
}

export interface MasteryItem {
  status: ItemStatus;
  R: number;
  weight: number;
}

/** An item contributes its current R once known/mastered, else 0 (Doc 7.3). */
export function itemContribution(item: MasteryItem): number {
  return countsAsKnown(item.status) ? item.R : 0;
}

/** Topic mastery = weighted average of item contributions. 0 when no weight. */
export function topicMastery(items: MasteryItem[]): number {
  let weightSum = 0;
  let weighted = 0;
  for (const it of items) {
    weightSum += it.weight;
    weighted += it.weight * itemContribution(it);
  }
  return weightSum === 0 ? 0 : weighted / weightSum;
}
