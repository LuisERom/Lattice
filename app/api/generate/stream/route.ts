import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { type NextRequest } from "next/server";
import { artifactRunDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 250;
const WAIT_FOR_FILE_MS = 30_000;
const MAX_STREAM_MS = 60 * 60_000; // 60 minutes — generation can take a long time

/** SSE frame with an id (byte offset) for resumable reconnects. */
function sseEvent(line: string, id: number): string {
  return `id: ${id}\ndata: ${line}\n\n`;
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return Response.json({ error: "slug query param is required" }, { status: 400 });
  }

  const streamPath = path.join(artifactRunDir(slug), "stream.ndjson");

  // Resume from the byte offset carried by the browser on automatic reconnect.
  const lastEventId = req.headers.get("last-event-id");
  const resumeOffset = lastEventId ? parseInt(lastEventId, 10) : 0;

  const encoder = new TextEncoder();
  let offset = Number.isFinite(resumeOffset) && resumeOffset > 0 ? resumeOffset : 0;
  let carry = "";
  let closed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const started = Date.now();
  const deadline = started + MAX_STREAM_MS;
  const waitDeadline = started + WAIT_FOR_FILE_MS;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const close = () => {
        if (closed) return;
        closed = true;
        if (intervalId !== null) clearInterval(intervalId);
        try { controller.close(); } catch { /* already closed */ }
      };

      intervalId = setInterval(() => {
        if (closed) {
          if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
          return;
        }

        if (Date.now() > deadline) {
          try {
            controller.enqueue(
              encoder.encode(sseEvent(JSON.stringify({ type: "timeout", message: "stream timed out" }), offset))
            );
          } catch { /* ignore */ }
          close();
          return;
        }

        if (!existsSync(streamPath)) {
          if (Date.now() > waitDeadline) {
            try {
              controller.enqueue(
                encoder.encode(sseEvent(JSON.stringify({ type: "error", message: "stream file not found" }), offset))
              );
            } catch { /* ignore */ }
            close();
          }
          return;
        }

        let size: number;
        try {
          size = statSync(streamPath).size;
        } catch {
          return;
        }
        if (size < offset) {
          offset = 0;
          carry = "";
        }
        if (size === offset) {
          return;
        }

        const len = size - offset;
        let buf: Buffer;
        try {
          const fd = openSync(streamPath, "r");
          buf = Buffer.alloc(len);
          readSync(fd, buf, 0, len, offset);
          closeSync(fd);
        } catch {
          return;
        }
        // Track byte position of each line so we can use it as the event id.
        let lineStartOffset = offset;
        offset = size;

        carry += buf.toString("utf8");
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";

        for (const line of lines) {
          if (closed) return;
          const trimmed = line.trim();
          const lineBytes = Buffer.byteLength(line + "\n", "utf8");
          const eventId = lineStartOffset + lineBytes;
          lineStartOffset += lineBytes;

          if (!trimmed) continue;
          try {
            controller.enqueue(encoder.encode(sseEvent(trimmed, eventId)));
          } catch {
            close();
            return;
          }
          try {
            const event = JSON.parse(trimmed) as { type?: string };
            if (event.type === "done") {
              close();
              return;
            }
          } catch {
            // Forwarded as raw line above; ignore parse failures for done detection.
          }
        }
      }, POLL_MS);
    },
    cancel() {
      closed = true;
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
