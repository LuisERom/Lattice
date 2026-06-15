import { getDb } from "@/lib/db";
import { submitReview, type SubmitReviewInput } from "@/lib/review";
import type { Grade } from "@/lib/fsrs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<SubmitReviewInput>;

  if (
    typeof body.itemId !== "number" ||
    typeof body.method !== "string" ||
    typeof body.rating !== "number"
  ) {
    return Response.json(
      { error: "itemId, method, and rating are required" },
      { status: 400 }
    );
  }
  if (![1, 2, 3, 4].includes(body.rating)) {
    return Response.json({ error: "rating must be 1..4" }, { status: 400 });
  }

  const result = submitReview(
    {
      itemId: body.itemId,
      method: body.method,
      rating: body.rating as Grade,
      userAnswer: body.userAnswer ?? "",
    },
    getDb()
  );

  return Response.json({
    ok: true,
    before: {
      due: result.reviewStateBefore.due,
      stability: result.reviewStateBefore.stability,
      state: result.reviewStateBefore.state,
      reps: result.reviewStateBefore.reps,
    },
    after: {
      due: result.reviewStateAfter.due,
      stability: result.reviewStateAfter.stability,
      state: result.reviewStateAfter.state,
      reps: result.reviewStateAfter.reps,
    },
  });
}
