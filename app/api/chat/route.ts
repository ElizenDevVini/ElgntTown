import type { NextRequest } from "next/server";

export const runtime = "nodejs"; // ensure Node runtime

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const apiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const model = body?.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 400 });
    }

    const upstream = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: body?.messages || [],
        temperature: 0.6,
        stream: false,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}: ${err}` }), { status: 502 });
    }

    const j = await upstream.json();

    // Normalize to { choices[0].message.content, usage }
    const content =
      j?.choices?.[0]?.message?.content ??
      j?.choices?.[0]?.text ??
      "";

    const usage = j?.usage ?? {};
    return Response.json({
      choices: [{ message: { content } }],
      usage,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown error" }), { status: 500 });
  }
}
