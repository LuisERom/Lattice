import { readFileSync } from "node:fs";
import path from "node:path";
import { type NextRequest } from "next/server";
import { importMap } from "@/lib/import";
import type { ContractMap } from "@/lib/import/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { slug?: string };
  const slug = (body.slug || "").trim();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "data", "generated", `${slug}.json`);
  try {
    const map = JSON.parse(readFileSync(filePath, "utf8")) as ContractMap;
    const result = importMap(map);
    return Response.json({
      ok: true,
      topicName: map.topic.name,
      topicId: result.topicId,
      counts: result.counts,
      file: filePath,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to import generated topic", detail: String(err) },
      { status: 500 }
    );
  }
}
