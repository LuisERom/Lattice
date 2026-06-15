import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPE_SYSTEM_PROMPT = `You are a scoping interviewer for a personal knowledge mastery system.
Define a PRECISE, FROZEN boundary for a subject so a finite knowledge graph can be generated.

Ask one focused question at a time. Build on prior answers. Propose concrete in/out boundaries.
If the user is unsure, choose sensible defaults and continue.

Respond ONLY with one JSON object:
Question:
{"type":"question","question":"...","rationale":"..."}

Finalize:
{
  "type":"scope",
  "name":"...",
  "scope_level":"working|deep|exam-ready",
  "scope_description":"...",
  "include":["..."],
  "exclude":["..."],
  "summary":"...",
  "outline":[
    {"section":"...","in":"...","out":"...","subsections":["..."]}
  ]
}

Infer scope_level from the conversation.`;

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  let body = trimmed;
  if (body.startsWith("```")) {
    body = body.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return JSON.parse(body);
}

type InterviewMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    messages?: InterviewMessage[];
    model?: string;
  };

  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages are required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const model = body.model || process.env.LATTICE_GEN_MODEL || "gpt-4o-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    ""
  );

  const payload = {
    model,
    messages: [{ role: "system", content: SCOPE_SYSTEM_PROMPT }, ...messages],
    temperature: 0.2,
    response_format: { type: "json_object" as const },
  };

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return Response.json(
      { error: `Interview LLM request failed (${resp.status})`, detail },
      { status: 502 }
    );
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = extractJson(content);
    return Response.json(parsed);
  } catch {
    return Response.json(
      { type: "question", question: content || "Could you clarify the scope boundary?" },
      { status: 200 }
    );
  }
}
