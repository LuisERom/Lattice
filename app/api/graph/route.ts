import { getDb } from "@/lib/db";
import { getGraphView } from "@/lib/graph";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getGraphView(getDb()));
}
