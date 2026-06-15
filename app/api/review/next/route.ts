import { getDb } from "@/lib/db";
import { nextReviewCard } from "@/lib/review";
import { memberNodeIds, type NodeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const card = nextReviewCard(db);
  if (!card) {
    return Response.json({ done: true });
  }

  const ids = memberNodeIds(card.item);
  const placeholders = ids.map(() => "?").join(",");
  const nodes =
    ids.length > 0
      ? (db
          .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
          .all(...ids) as NodeRow[])
      : [];
  const nodeNames = ids
    .map((id) => nodes.find((n) => n.id === id)?.name)
    .filter(Boolean) as string[];

  return Response.json({
    done: false,
    remainingDue: card.remainingDue,
    item: { id: card.item.id, kind: card.item.kind },
    nodeNames,
    method: card.method,
    question: {
      id: card.question.id,
      method: card.question.method,
      prompt: card.question.prompt,
      expected_answer: card.question.expected_answer,
      options: card.question.options ? JSON.parse(card.question.options) : null,
    },
    retrievabilityBefore: card.retrievabilityBefore,
    due: card.reviewStateBefore.due,
    state: card.reviewStateBefore.state,
  });
}
