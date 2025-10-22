"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/**
 * Gargle — Brainrot Experiment (Powered by GPT)
 * 2025-grade UI:
 * - Structural redesign (12-col layout): Left control/state, Center chart+chat, Right logs
 * - Elevated cards, crisp borders, compact KPI strip
 * - Animated background sheen + floating orb, smooth motion (no emojis)
 * - White theme preserved, same primary color
 */

type AgentId = "gargle";
type Message = { from: "user" | AgentId; text: string; ts: number };
type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type Intensity = "low" | "medium" | "high";

const AGENT = { id: "gargle" as const, name: "Gargle", poweredBy: "GPT", backendModel: "gpt-4o-mini" };
const BRAND = { primary: "#2563eb" }; // keep color

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
        { role: "system", content: "You are Gargle (GPT), under noisy brain-rot inputs. Be brief and resilient." },
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
  return { focusDrift, coherence, anxiety, curiosity, stability, fatigue, volatility };
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

      // Log feed (as a "user" feed line)
      if (Math.random() < 0.7) {
        setMessages((prev) => {
          const next: Message[] = [...prev, { from: "user" as const, text: `Feed → ${topic}`, ts: now }];
          return next.slice(-300);
        });
      }

      // Update index + chart
      const idx = computeIndex(usageRef.current, now);
      setLevel((prev) => ({ gargle: clamp(prev.gargle * (1 - ALPHA) + idx * ALPHA) }));
      setSeries((prev) => {
        const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
        return [...prev, { t, gargle: level.gargle }].slice(-240);
      });

      // Autonomous reaction sometimes
      if (Math.random() < 0.5) {
        const reaction = simulatedResponse(rng, topic, level.gargle);
        const approxOut = Math.max(8, Math.ceil(reaction.split(/\s+/).length * 1.3));
        usageRef.current.push({ ts: Date.now(), in: 6, out: approxOut });
        setMessages((prev) => {
          const next: Message[] = [...prev, { from: "gargle" as const, text: reaction, ts: Date.now() }];
          return next.slice(-300);
        });
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

    setMessages((prev) => [...prev, { from: "user" as const, text, ts }]);

    const res = await callLLM(text, messages);
    if (res) {
      const { text: reply, usage } = res;
      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? (usage.total_tokens ? Math.max(0, usage.total_tokens - inTok) : 0);
      usageRef.current.push({ ts: Date.now(), in: inTok, out: outTok });
      setMessages((prev) => [...prev, { from: "gargle" as const, text: reply || "", ts: ts + 400 }]);
    } else {
      const reply = simulatedResponse(rng, text, level.gargle);
      const approxOut = Math.max(8, Math.ceil(reply.split(/\s+/).length * 1.3));
      const approxIn = Math.max(4, Math.ceil(text.split(/\s+/).length * 1.0));
      usageRef.current.push({ ts: Date.now(), in: approxIn, out: approxOut });
      setMessages((prev) => [...prev, { from: "gargle" as const, text: reply, ts: ts + 400 }]);
    }
  }

  const mental = React.useMemo(() => computeMentalState(series.map((p) => p.gargle)), [series]);
  const kpis = React.useMemo(() => {
    const cur = level.gargle;
    const avg = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
    const vol = mental.volatility ?? 0;
    return { cur, avg, vol };
  }, [level, series, mental]);

  // ---- UI -------------------------------------------------------------------
  return (
    <div className="relative min-h-screen text-neutral-900">
      {/* Animated sheen + orb (subtle, white theme) */}
      <motion.div aria-hidden className="bg-sheen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      <motion.div
        aria-hidden
        className="absolute -z-10 w-[50rem] h-[50rem] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(37,99,235,0.06), transparent 70%)" }}
        initial={{ x: "-15%", y: "-12%", opacity: 0 }}
        animate={{ x: ["-15%", "12%", "-8%"], y: ["-12%", "6%", "-4%"], opacity: 1 }}
        transition={{ duration: 18, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
      />

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Gargle — Brainrot Experiment</h1>
              <div className="text-xs text-neutral-500">Powered by GPT · Always On</div>
            </motion.div>

            {/* KPI strip */}
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden md:flex items-center gap-3"
            >
              <div className="kpi">
                <span className="kpi-label">Current</span>
                <span className="kpi-value">{kpis.cur.toFixed(2)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Avg</span>
                <span className="kpi-value">{kpis.avg.toFixed(2)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Vol</span>
                <span className="kpi-value">{kpis.vol.toFixed(2)}</span>
              </div>
              <div className="badge">No Pause</div>
            </motion.div>
          </div>
        </div>
      </header>

      {/* Main grid: 12 cols */}
      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-12 gap-6">
        {/* Left: Controls + Mental State */}
        <section className="col-span-12 lg:col-span-3 space-y-6">
          <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="section-title">Controls</div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-neutral-600">Feed intensity</label>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((lvl) => (
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    key={lvl}
                    onClick={() => setIntensity(lvl)}
                    className={`pill ${intensity === lvl ? "pill-active" : ""}`}
                  >
                    {lvl}
                  </motion.button>
                ))}
              </div>
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              Ingests: {FEEDS[intensity].join(" · ")}
            </div>
          </motion.div>

          <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="section-title">Mental State</div>
            <ul className="space-y-3">
              {Object.entries(mental).filter(([k]) => k !== "volatility").map(([k, v]) => (
                <li key={k} className="grid grid-cols-5 items-center gap-2">
                  <div className="col-span-2 text-xs text-neutral-800 capitalize">{k.replace(/([A-Z])/g, " $1")}</div>
                  <div className="col-span-3 h-2 rounded-full bg-neutral-200 overflow-hidden">
                    <div className="h-2 rounded-full" style={{ width: `${(v * 100).toFixed(0)}%`, background: BRAND.primary }} />
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        </section>

        {/* Center: Chart + Chat */}
        <section className="col-span-12 lg:col-span-6 space-y-6">
          <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="section-title">Brainrot Index</div>
            <div className="h-64 w-full">
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
          </motion.div>

          <motion.div className="panel overflow-hidden" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="section-title">Chat</div>
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
                        m.from === "user" ? "bubble-user" : "bubble-ai"
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
              <motion.button whileTap={{ scale: 0.98 }} type="submit" className="px-4 py-2 rounded-md border bg-neutral-900 text-white text-sm">
                Send
              </motion.button>
            </form>
          </motion.div>
        </section>

        {/* Right: Logs */}
        <section className="col-span-12 lg:col-span-3 space-y-6">
          <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="section-title">Gargle Logs</div>
            <div ref={logsRef} className="h-[520px] overflow-y-auto pr-1">
              <ul className="space-y-2 text-sm">
                {messages.map((m, i) => (
                  <li key={i} className={`log-row ${m.from === "user" ? "log-feed" : "log-ai"}`}>
                    <span className="log-ts">{new Date(m.ts).toLocaleTimeString()}</span>
                    <span className="log-who">{m.from === "user" ? "Feed" : AGENT.name}</span>
                    <span className="log-text">{m.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          <motion.div className="panel-muted" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="section-title">Integration</div>
            <p className="text-xs text-neutral-600">
              Backend must return <code>{'{ choices[0].message.content, usage }'}</code> (OpenAI-style). The UI tolerates variations.
            </p>
          </motion.div>
        </section>
      </main>
    </div>
  );
}
