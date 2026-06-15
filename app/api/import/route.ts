import { readFileSync } from "node:fs";
import { type NextRequest } from "next/server";
import { importMap } from "@/lib/import";
import type { ContractMap } from "@/lib/import/contract";
import { generatedTopicPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { slug?: string };
  const slug = (body.slug || "").trim();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const filePath = generatedTopicPath(slug);
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
