import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getGraphView } from "@/lib/graph";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("topicId");
  const parsed = raw != null && raw !== "" ? Number(raw) : null;
  const topicId =
    parsed != null && Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  return Response.json(getGraphView(getDb(), new Date(), topicId));
}
