import { getDb } from "@/lib/db";
import { getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getDashboard(getDb()));
}
