import { getDb } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  type Settings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    settings: getSettings(getDb()),
    defaults: DEFAULT_SETTINGS,
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<Settings>;
  const patch: Partial<Settings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      patch[key] = v;
    }
  }
  const settings = updateSettings(patch, getDb());
  return Response.json({ ok: true, settings });
}
