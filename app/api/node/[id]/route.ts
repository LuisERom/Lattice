import { getDb } from "@/lib/db";
import { getNodeDetail } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const nodeId = Number(id);
  if (!Number.isInteger(nodeId)) {
    return Response.json({ error: "invalid node id" }, { status: 400 });
  }
  const detail = getNodeDetail(nodeId, getDb());
  if (!detail) {
    return Response.json({ error: "node not found" }, { status: 404 });
  }
  return Response.json(detail);
}
