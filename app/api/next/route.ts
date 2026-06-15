import { getDb } from "@/lib/db";
import { getWhatToLearnNext } from "@/lib/sequencing";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getWhatToLearnNext(getDb()));
}
