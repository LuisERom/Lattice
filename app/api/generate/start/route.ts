import {
  mkdirSync,
  createWriteStream,
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { type NextRequest } from "next/server";
import { artifactRunDir } from "@/lib/paths";

/**
 * Read the project .env / .env.local from disk at spawn time so that variables
 * added after the server started are present in the Python subprocess.
 */
function readDotEnvFiles(root: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    try {
      const content = readFileSync(path.join(root, name), "utf8");
      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const eq = line.indexOf("=");
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key) vars[key] = value;
      }
    } catch {
      // missing file
    }
  }
  return vars;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "topic";
}

type RunMeta = {
  subject: string;
  scopeDescription: string;
  scopeLevel: "working" | "deep" | "exam-ready";
  slug: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    subject?: string;
    scopeDescription?: string;
    scopeLevel?: "working" | "deep" | "exam-ready";
    slug?: string;
    model?: string;
    fastModel?: string;
    resume?: boolean;
  };

  const resume = !!body.resume;
  const root = path.join(/* turbopackIgnore: true */ process.cwd());

  let subject = (body.subject || "").trim();
  let scopeDescription = (body.scopeDescription || "").trim();
  let scopeLevel = body.scopeLevel || "deep";
  let slug = body.slug?.trim() ? slugify(body.slug.trim()) : "";

  if (resume) {
    if (!slug) {
      return Response.json({ error: "slug is required to resume" }, { status: 400 });
    }
    const metaPath = path.join(artifactRunDir(slug), "run.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;
        subject = subject || meta.subject;
        scopeDescription = scopeDescription || meta.scopeDescription;
        scopeLevel = body.scopeLevel || meta.scopeLevel || "deep";
      } catch {
        // fall through
      }
    }
  } else {
    const baseSlug = body.slug?.trim() || `${slugify(subject)}-${Date.now()}`;
    slug = slugify(baseSlug);
  }

  if (!subject || !scopeDescription) {
    return Response.json(
      { error: "subject and scopeDescription are required" },
      { status: 400 }
    );
  }

  const artifactDir = artifactRunDir(slug);
  mkdirSync(artifactDir, { recursive: true });
  const streamPath = path.join(artifactDir, "stream.ndjson");
  const runLogPath = path.join(artifactDir, "run.log");
  const pidPath = path.join(artifactDir, "run.pid");

  if (existsSync(pidPath)) {
    return Response.json(
      { error: "A generator process is already running for this slug. Stop it first." },
      { status: 409 }
    );
  }

  if (!resume) {
    writeFileSync(streamPath, "", "utf8");
    writeFileSync(runLogPath, "", "utf8");
  } else {
    if (!existsSync(streamPath)) writeFileSync(streamPath, "", "utf8");
    appendFileSync(
      streamPath,
      JSON.stringify({ type: "resumed" }) + "\n",
      "utf8"
    );
    appendFileSync(runLogPath, `\n[resume] ${new Date().toISOString()}\n`, "utf8");
  }

  writeFileSync(
    path.join(artifactDir, "run.json"),
    JSON.stringify(
      { subject, scopeDescription, scopeLevel, slug } satisfies RunMeta,
      null,
      2
    ),
    "utf8"
  );

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
  if (resume) {
    args.push("--resume");
  }
  if (body.model) {
    args.push("--model", body.model);
  }
  if (body.fastModel) {
    args.push("--fast-model", body.fastModel);
  }

  const dotEnvVars = readDotEnvFiles(root);
  const child = spawn(pythonBin, args, {
    cwd: root,
    env: { ...process.env, ...dotEnvVars },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (child.pid) {
    writeFileSync(pidPath, String(child.pid), "utf8");
  }

  const log = createWriteStream(runLogPath, { flags: "a" });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once("error", (err) => {
    log.write(`\n[spawn-error] ${String(err)}\n`);
    try {
      if (existsSync(pidPath)) unlinkSync(pidPath);
    } catch {
      // ignore
    }
  });
  child.once("close", (code) => {
    log.write(`\n[exit] code=${String(code)}\n`);
    log.end();
    try {
      if (existsSync(pidPath)) unlinkSync(pidPath);
    } catch {
      // ignore
    }
  });

  return Response.json({ ok: true, slug, resume });
}
