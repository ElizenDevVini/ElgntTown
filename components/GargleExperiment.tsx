"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/**
 * Gargle — Brainrot Experiment (Powered by Claude)
 * Clean white UI, no emojis, Framer Motion animations, elegant cards,
 * background sheen, always-on feeder, Brainrot Index chart, logs, mental state.
 */

type AgentId = "gargle";
type Message = { from: "user" | AgentId; text: string; ts: number };
type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type Intensity = "low" | "medium" | "high";

const AGENT = { id: "gargle" as const, name: "Gargle", poweredBy: "Claude", backendModel: "claude-3-5-sonnet-latest" };
const BRAND = { primary: "#2563eb" }; // blue-600

// ---- Math helpers -----------------------------------------------------------
const WINDOW_MS = 60_000;
const SOFT_CAP_TOKENS_PER_MIN = 12_000;
const ALPHA = 0.35;

function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function computeIndex(samples: UsageSample[], now: number = Date.now()) {
  const recent = samples.filter((s) => now - s.ts <= WINDOW_MS);
  if (!recent.length) return 0;
  const tokens = recent.reduce((sum, s) => sum + s.in + s.out, 0);
  const rate = tokens / (WINDOW_MS / 60_000);
  const idx = 1 - Math.exp(-(rate / SOFT_CAP_TOKENS_PER_MIN));
  return clamp(idx);
}
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function simulatedResponse(rng: () => number, prompt: string, brainrot: number) {
  const fragments = ["drift detected", "context window saturated", "signal chasing", "pattern echo", "semantic blur", "topic hop", "overfit loop"];
  const pick = () => fragments[Math.floor(rng() * fragments.length)];
  const base = prompt.split(/\s+/).slice(0, Math.max(4, Math.floor(12 - brainrot * 6))).join(" ");
  const tail = Array.from({ length: Math.max(1, Math.floor(brainrot * 3)) }).map(pick).join(" · ");
  const derail = Math.random() < brainrot * 0.6 ? ` | ${pick()} > ${pick()}` : "";
  return `Gargle: ${base} — ${tail}${derail}`.trim();
}
const FEEDS = {
  low: ["mild trend headlines", "benign product reviews", "light meme summaries"],
  medium: ["fast-paced social snippets", "contradictory takes", "quote-chain speculation"],
  high: ["out-of-context fragments", "comment storms", "looping bait claims"],
} as const;

function extractTextAndUsage(j: any): { text: string; usage: Usage } {
  const text =
    j?.choices?.[0]?.message?.content ??
    j?.choices?.[0]?.text ??
    j?.message ??
    j?.content ??
    j?.output_text ??
    j?.data?.text ?? "";
  const usage: Usage =
    j?.usage ?? j?.meta?.usage ?? {
      total_tokens: text ? Math.ceil(text.split(/\s+/).length * 2) : 0,
      prompt_tokens: undefined,
      completion_tokens: text ? Math.ceil(text.split(/\s+/).length * 1.5) : 0,
    };
  return { text, usage };
}

async function callLLM(userText: string, history: Message[]) {
  try {
    const payload = {
      model: AGENT.backendModel,
      messages: [
        { role: "system", content: "You are Gargle (Claude), under noisy brain-rot inputs. Be brief and resilient." },
        ...history.map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text })),
        { role: "user", content: userText },
      ],
      stream: false,
    };
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return extractTextAndUsage(j);
  } catch {
    return null;
  }
}

function computeMentalState(levels: number[]) {
  const n = levels.length;
  const cur = levels[n - 1] ?? 0;
  const prev = levels[n - 2] ?? cur;
  const delta = Math.abs(cur - prev);
  const window = levels.slice(-10);
  const volatility = window.length > 1 ? window.slice(1).reduce((s, v, i) => s + Math.abs(v - window[i]), 0) / (window.length - 1) : 0;

  const focusDrift = clamp(0.7 * cur + 0.3 * volatility);
  const coherence = clamp(1 - (0.5 * cur + 0.5 * volatility));
  const anxiety = clamp(0.6 * volatility + 0.3 * cur + 0.1 * delta);
  const curiosity = clamp(1 - (0.6 * cur + 0.4 * volatility));
  const stability = clamp(1 - (0.6 * cur + 0.8 * volatility));
  const fatigue = clamp(0.6 * cur + 0.2 * volatility);
  return { focusDrift, coherence, anxiety, curiosity, stability, fatigue };
}

// ---- Component --------------------------------------------------------------
export default function GargleExperiment() {
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [messages, setMessages] = useState<Message[]>([]);
  const [series, setSeries] = useState<BrainrotPoint[]>([]);
  const [level, setLevel] = useState<Record<AgentId, number>>({ gargle: 0 });
  const usageRef = useRef<UsageSample[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const rng = useMemo(() => mulberry32(Math.floor(Date.now() % 1e7)), []);

  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // Always-on feeder loop
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const bucket = FEEDS[intensity];
      const topic = bucket[Math.floor(rng() * bucket.length)];

      // Feed ingestion tokens (inbound)
      const approxIn = 20 + Math.floor(rng() * (intensity === "high" ? 180 : intensity === "medium" ? 90 : 40));
      usageRef.current.push({ ts: now, in: approxIn, out: 0 });

      // Log feed
      if (Math.random() < 0.7) {
        setMessages((prev) => [...prev, { from: "user", text: `Feed → ${topic}`, ts: now }].slice(-250));
      }

      // Update index + chart
      const idx = computeIndex(usageRef.current, now);
      setLevel((prev) => ({ gargle: clamp(prev.gargle * (1 - ALPHA) + idx * ALPHA) }));
      setSeries((prev) => {
        const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
        return [...prev, { t, gargle: level.gargle }].slice(-180);
      });

      // Autonomous reaction sometimes
      if (Math.random() < 0.5) {
        const reaction = simulatedResponse(rng, topic, level.gargle);
        const approxOut = Math.max(8, Math.ceil(reaction.split(/\s+/).length * 1.3));
        usageRef.current.push({ ts: Date.now(), in: 6, out: approxOut });
        setMessages((prev) => [...prev, { from: "gargle", text: reaction, ts: Date.now() }].slice(-250));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [intensity, rng, level.gargle]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const el = inputRef.current;
    if (!el || !el.value.trim()) return;
    const text = el.value.trim();
    el.value = "";
    const ts = Date.now();

    setMessages((prev) => [...prev, { from: "user", text, ts }]);

    const res = await callLLM(text, messages);
    if (res) {
      const { text: reply, usage } = res;
      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? (usage.total_tokens ? Math.max(0, usage.total_tokens - inTok) : 0);
      usageRef.current.push({ ts: Date.now(), in: inTok, out: outTok });
      setMessages((prev) => [...prev, { from: "gargle", text: reply || "", ts: ts + 400 }]);
    } else {
      const reply = simulatedResponse(rng, text, level.gargle);
      const approxOut = Math.max(8, Math.ceil(reply.split(/\s+/).length * 1.3));
      const approxIn = Math.max(4, Math.ceil(text.split(/\s+/).length * 1.0));
      usageRef.current.push({ ts: Date.now(), in: approxIn, out: approxOut });
      setMessages((prev) => [...prev, { from: "gargle", text: reply, ts: ts + 400 }]);
    }
  }

  const mental = React.useMemo(() => computeMentalState(series.map((p) => p.gargle)), [series]);
  const kpis = React.useMemo(() => {
    const cur = level.gargle;
    const avg = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
    return { cur, avg };
  }, [level, series]);

  // ---- UI -------------------------------------------------------------------
  return (
    <div className="relative min-h-screen text-neutral-900">
      {/* Subtle animated sheen behind all content */}
      <motion.div
        aria-hidden
        className="bg-sheen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      {/* Floating gradient orb */}
      <motion.div
        aria-hidden
        className="absolute -z-10 w-[50rem] h-[50rem] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(37,99,235,0.06), transparent 70%)" }}
        initial={{ x: "-20%", y: "-10%", opacity: 0 }}
        animate={{ x: ["-20%", "10%", "-10%"], y: ["-10%", "5%", "-5%"], opacity: 1 }}
        transition={{ duration: 14, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
      />

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Gargle — Brainrot Experiment</h1>
            <div className="text-xs text-neutral-500">Powered by Claude · Always On</div>
          </motion.div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="badge">No Pause</span>
            <span className="badge">White Theme</span>
          </div>
        </div>
      </header>

      {/* Top: Chart + Mental State */}
      <section className="border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 py-10 md:py-14 grid md:grid-cols-2 gap-8 items-start">
          <motion.div className="card p-4" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-neutral-600">Brainrot Index</div>
              <div className="text-xs text-neutral-500">current {kpis.cur.toFixed(2)} · avg {kpis.avg.toFixed(2)}</div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ left: 6, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="t" stroke="#525252" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 1]} stroke="#525252" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ color: "#171717" }} />
                  <Line type="monotone" dataKey="gargle" name="Gargle" dot={false} strokeWidth={2} stroke={BRAND.primary} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm text-neutral-600">Feed intensity</label>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setIntensity(lvl)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition ${
                      intensity === lvl ? "bg-neutral-900 text-white border-neutral-900" : "bg-white border-neutral-300 hover:border-neutral-500"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.div className="card p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-sm text-neutral-600 mb-3">Gargle — Mental State</div>
            <ul className="space-y-3">
              {Object.entries(mental).map(([k, v]) => (
                <li key={k} className="grid grid-cols-5 items-center gap-2">
                  <div className="col-span-2 text-xs text-neutral-800 capitalize">{k.replace(/([A-Z])/g, " $1")}</div>
                  <div className="col-span-3 h-2 rounded-full bg-neutral-200 overflow-hidden">
                    <div className="h-2 rounded-full" style={{ width: `${(v * 100).toFixed(0)}%`, background: BRAND.primary }} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-neutral-500">Derived from index level, short-term delta, and volatility.</div>
          </motion.div>
        </div>
      </section>

      {/* Bottom: Chat + Logs */}
      <main className="max-w-7xl mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-600">Talk to Gargle</div>
            <div className="text-xs text-neutral-500">Type and press Enter</div>
          </div>

          <div className="card overflow-hidden">
            <div className="h-[360px] overflow-y-auto px-5 py-4 space-y-3">
              <AnimatePresence initial={false}>
                {messages.map((m, idx) => (
                  <motion.div
                    key={m.ts + "-" + idx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`max-w-[85%] ${m.from === "user" ? "ml-auto" : "mr-auto"}`}
                  >
                    <div
                      className={`px-3 py-2 rounded-xl border text-sm leading-relaxed ${
                        m.from === "user" ? "bg-neutral-900 text-white border-neutral-900" : "bg-neutral-50 text-neutral-900 border-neutral-200"
                      }`}
                    >
                      {m.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <form onSubmit={onSubmit} className="border-t border-neutral-200 p-3 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder={`Message ${AGENT.name}`}
                className="flex-1 px-3 py-2 rounded-md bg-neutral-50 border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
              <button type="submit" className="px-4 py-2 rounded-md border bg-neutral-900 text-white text-sm">Send</button>
            </form>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-neutral-600">Gargle Logs</div>
              <div className="text-xs text-neutral-500">auto-ingesting</div>
            </div>
            <div ref={logsRef} className="h-[420px] overflow-y-auto pr-1">
              <ul className="space-y-2 text-sm">
                {messages.map((m, i) => (
                  <li key={i} className={`px-2 py-1.5 rounded-md border ${m.from === "user" ? "bg-neutral-50 border-neutral-200" : "bg-white border-neutral-200"}`}>
                    <span className="text-xs text-neutral-500 mr-2">{new Date(m.ts).toLocaleTimeString()}</span>
                    <span className="font-medium mr-1">{m.from === "user" ? "Feed" : AGENT.name}</span>
                    <span className="text-neutral-800">{m.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card-muted p-4">
            <div className="text-sm text-neutral-600 mb-2">Integration Notes</div>
            <p className="text-xs text-neutral-600">
              Backend must return <code>{'{ choices[0].message.content, usage }'}</code> (OpenAI-style).
              The UI tolerates Anthropic by reshaping on the server.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
