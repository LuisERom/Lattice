import { getDb } from "@/lib/db";
import { getGraphView } from "@/lib/graph";
import { getPrimaryTopicId } from "@/lib/mastery";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const raw = url.searchParams.get("topicId");
  const parsed = raw != null ? Number(raw) : NaN;
  const topicId = Number.isFinite(parsed) ? parsed : getPrimaryTopicId(db);
  return Response.json(getGraphView(db, new Date(), topicId));
}
