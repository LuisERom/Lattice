import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getGraphView } from "@/lib/graph";
import { getPrimaryTopicId } from "@/lib/mastery";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const db = getDb();
  const raw = req.nextUrl.searchParams.get("topicId");
  const parsed = raw != null && raw !== "" ? Number(raw) : NaN;
  const topicId = Number.isFinite(parsed) ? Math.trunc(parsed) : getPrimaryTopicId(db);
  return Response.json(getGraphView(db, new Date(), topicId));
}
