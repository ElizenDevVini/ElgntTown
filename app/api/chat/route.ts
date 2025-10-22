import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { model, messages } = await req.json()
    const apiKey = process.env.OPENAI_API_KEY
    const base = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'
    const resolvedModel = model || process.env.OPENAI_MODEL || 'gpt-4o-mini'

    if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 400 })

    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: resolvedModel, messages: messages || [], temperature: 0.7 })
    })

    if (!r.ok) {
      const err = await r.text()
      return NextResponse.json({ error: 'Upstream error', detail: err }, { status: r.status })
    }

    const j = await r.json()
    const text = j?.choices?.[0]?.message?.content ?? ''
    const usage = j?.usage ?? {
      total_tokens: text.split(/\s+/).length * 2,
      prompt_tokens: undefined,
      completion_tokens: undefined
    }
    // Always return choices for the client
    return NextResponse.json({ choices: [{ message: { content: text } }], usage })
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', detail: String(e) }, { status: 500 })
  }
}
