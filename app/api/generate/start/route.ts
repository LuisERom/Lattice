import { mkdirSync, createWriteStream, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { type NextRequest } from "next/server";
import { artifactRunDir } from "@/lib/paths";

/**
 * Read the project .env file from disk at spawn time so that variables added
 * after the server started (e.g. VOYAGE_BASE_URL) are always present in the
 * Python subprocess, regardless of when `npm run dev` was last run.
 */
function readDotEnvFile(root: string): Record<string, string> {
  try {
    const content = readFileSync(path.join(root, ".env"), "utf8");
    const vars: Record<string, string> = {};
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key) vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "topic";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    subject?: string;
    scopeDescription?: string;
    scopeLevel?: "working" | "deep" | "exam-ready";
    slug?: string;
    model?: string;
    fastModel?: string;
  };

  const subject = (body.subject || "").trim();
  const scopeDescription = (body.scopeDescription || "").trim();
  const scopeLevel = body.scopeLevel || "deep";
  if (!subject || !scopeDescription) {
    return Response.json(
      { error: "subject and scopeDescription are required" },
      { status: 400 }
    );
  }

  const baseSlug = body.slug?.trim() || `${slugify(subject)}-${Date.now()}`;
  const slug = slugify(baseSlug);

  const root = path.join(/* turbopackIgnore: true */ process.cwd());
  const artifactDir = artifactRunDir(slug);
  mkdirSync(artifactDir, { recursive: true });
  const streamPath = path.join(artifactDir, "stream.ndjson");
  const runLogPath = path.join(artifactDir, "run.log");
  writeFileSync(streamPath, "", "utf8");
  writeFileSync(runLogPath, "", "utf8");

  const pythonBin =
    process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

  const args = [
    path.join("generator", "generate.py"),
    "--no-interview",
    "--subject",
    subject,
    "--scope-description",
    scopeDescription,
    "--scope-level",
    scopeLevel,
    "--slug",
    slug,
    "--yes",
  ];
  if (body.model) {
    args.push("--model", body.model);
  }
  if (body.fastModel) {
    args.push("--fast-model", body.fastModel);
  }

  // Merge live .env on top of process.env so Python always gets up-to-date
  // values (e.g. VOYAGE_BASE_URL) even if the dev server started before they
  // were added to .env.
  const dotEnvVars = readDotEnvFile(root);
  const child = spawn(pythonBin, args, {
    cwd: root,
    env: { ...process.env, ...dotEnvVars },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const log = createWriteStream(runLogPath, { flags: "a" });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once("error", (err) => {
    log.write(`\n[spawn-error] ${String(err)}\n`);
  });
  child.once("close", (code) => {
    log.write(`\n[exit] code=${String(code)}\n`);
    log.end();
  });

  return Response.json({ ok: true, slug });
}
