import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { type NextRequest } from "next/server";
import { artifactRunDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Already exited.
    }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already exited.
  }
  // Give it a moment, then force.
  try {
    execSync(`kill -9 ${pid}`, { stdio: "ignore" });
  } catch {
    // ignore
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { slug?: string };
  const slug = (body.slug || "").trim();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const dir = artifactRunDir(slug);
  const pidPath = path.join(dir, "run.pid");
  const streamPath = path.join(dir, "stream.ndjson");

  if (!existsSync(pidPath)) {
    // Still mark stopped so the UI can offer resume.
    if (existsSync(streamPath)) {
      appendFileSync(
        streamPath,
        JSON.stringify({ type: "stopped", reason: "no_pid" }) + "\n",
        "utf8"
      );
    }
    return Response.json({ ok: true, slug, killed: false, reason: "no_pid" });
  }

  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return Response.json({ error: "invalid pid file" }, { status: 500 });
  }

  killProcessTree(pid);
  try {
    unlinkSync(pidPath);
  } catch {
    // ignore
  }

  appendFileSync(
    streamPath,
    JSON.stringify({ type: "stopped", pid }) + "\n",
    "utf8"
  );

  return Response.json({ ok: true, slug, killed: true, pid });
}
