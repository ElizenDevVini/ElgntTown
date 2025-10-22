"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/**
 * Gargle — Brainrot Lab (Arena Style)
 * - Always-on experiment
 * - Arena-like layout: ticker, tabs, chart, logs, README column
 * - White theme, no emojis, colors preserved
 */

type AgentId = "gargle";
type Message = { from: "user" | AgentId; text: string; ts: number };
type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type Intensity = "low" | "medium" | "high";
type RangeKey = "ALL" | "2M";

const AGENT = { id: "gargle" as const, name: "Gargle", poweredBy: "GPT", backendModel: "gpt-4o-mini" };
// keep your existing accent color
const BRAND = { primary: "#2563eb" };

// ---- math ----------
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

// ---- component ----------
export default function GargleExperiment() {
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [messages, setMessages] = useState<Message[]>([]);
  const [series, setSeries] = useState<BrainrotPoint[]>([]);
  const [level, setLevel] = useState<Record<AgentId, number>>({ gargle: 0 });
  const [range, setRange] = useState<RangeKey>("ALL");

  const usageRef = useRef<UsageSample[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const rng = useMemo(() => mulberry32(Math.floor(Date.now() % 1e7)), []);

  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // feeder loop
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const bucket = FEEDS[intensity];
      const topic = bucket[Math.floor(rng() * bucket.length)];

      // ingest
      const approxIn = 20 + Math.floor(rng() * (intensity === "high" ? 180 : intensity === "medium" ? 90 : 40));
      usageRef.current.push({ ts: now, in: approxIn, out: 0 });

      // feed log
      if (Math.random() < 0.7) {
        setMessages((prev) => {
          const next: Message[] = [...prev, { from: "user" as const, text: `Feed → ${topic}`, ts: now }];
          return next.slice(-350);
        });
      }

      // index + chart
      const idx = computeIndex(usageRef.current, now);
      setLevel((prev) => ({ gargle: clamp(prev.gargle * (1 - ALPHA) + idx * ALPHA) }));
      setSeries((prev) => {
        const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
        return [...prev, { t, gargle: level.gargle }].slice(-360);
      });

      // autonomous reply sometimes
      if (Math.random() < 0.5) {
        const reaction = simulatedResponse(rng, topic, level.gargle);
        const approxOut = Math.max(8, Math.ceil(reaction.split(/\s+/).length * 1.3));
        usageRef.current.push({ ts: Date.now(), in: 6, out: approxOut });
        setMessages((prev) => {
          const next: Message[] = [...prev, { from: "gargle" as const, text: reaction, ts: Date.now() }];
          return next.slice(-350);
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

  const mental = useMemo(() => computeMentalState(series.map((p) => p.gargle)), [series]);
  const cur = level.gargle;
  const avg = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
  const vol = mental.volatility ?? 0;

  // range slice (arena-style ALL/72H tab clone; here: ALL vs last 120 ticks ~ 2m)
  const displaySeries = useMemo(() => {
    if (range === "ALL") return series;
    const take = 120;
    return series.slice(-take);
  }, [series, range]);

  const lastVal = displaySeries.length ? displaySeries[displaySeries.length - 1].gargle : 0;

  return (
    <div className="relative min-h-screen text-neutral-900 arena-root">
      <motion.div aria-hidden className="bg-sheen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />

      {/* top nav / brand */}
      <header className="arena-top">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-baseline gap-3">
              <div className="arena-logo">Gargle Lab</div>
              <nav className="arena-nav hidden md:flex">
                <a className="is-active">LIVE</a>
                <a>LEADERBOARD</a>
                <a>MODELS</a>
              </nav>
            </div>
            <div className="arena-actions hidden md:flex">
              <span className="arena-chip">Powered by {AGENT.poweredBy}</span>
              <span className="arena-chip">Always On</span>
            </div>
          </div>
        </div>
        {/* ticker */}
        <div className="arena-ticker">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="tix">
              <span className="tix-key">INDEX</span>
              <span className="tix-val">{cur.toFixed(3)}</span>
            </div>
            <div className="tix">
              <span className="tix-key">AVG</span>
              <span className="tix-val">{avg.toFixed(3)}</span>
            </div>
            <div className="tix">
              <span className="tix-key">VOL</span>
              <span className="tix-val">{vol.toFixed(3)}</span>
            </div>
            <div className="tix">
              <span className="tix-key">INTENSITY</span>
              <span className="tix-val">{intensity.toUpperCase()}</span>
            </div>
            <div className="tix">
              <span className="tix-key">FEEDS</span>
              <span className="tix-val">{FEEDS[intensity].length}</span>
            </div>
            <div className="tix">
              <span className="tix-key">AGENT</span>
              <span className="tix-val">{AGENT.name}</span>
            </div>
          </div>
        </div>
      </header>

      {/* main grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        {/* center column: chart + chat */}
        <section className="col-span-12 lg:col-span-8 space-y-6">
          {/* chart panel styled like arena */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title">TOTAL BRAINROT</div>
              <div className="arena-tabs">
                <button className={`arena-tab ${range === "ALL" ? "is-active" : ""}`} onClick={() => setRange("ALL")}>ALL</button>
                <button className={`arena-tab ${range === "2M" ? "is-active" : ""}`} onClick={() => setRange("2M")}>2M</button>
              </div>
            </div>
            <div className="relative h-[420px]">
              <div className="absolute right-4 top-4 arena-float-tag">
                <span className="dot" style={{ background: BRAND.primary }} />
                {AGENT.name} <b>{lastVal.toFixed(3)}</b>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displaySeries} margin={{ left: 8, right: 16, top: 12, bottom: 8 }}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="t" stroke="#171717" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 1]} stroke="#171717" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #111", borderRadius: 0, padding: 8 }}
                    labelStyle={{ fontSize: 11, color: "#111" }}
                    itemStyle={{ fontSize: 11, color: "#111" }}
                  />
                  {/* keep your color, thicken stroke for arena look */}
                  <Line type="monotone" dataKey="gargle" dot={false} strokeWidth={3} stroke={BRAND.primary} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="arena-subgrid">
              <div className="arena-mini">
                <div className="mini-key">FEED INTENSITY</div>
                <div className="mini-controls">
                  {(["low", "medium", "high"] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setIntensity(lvl)}
                      className={`mini-pill ${intensity === lvl ? "is-on" : ""}`}
                    >
                      {lvl.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="mini-foot">{FEEDS[intensity].join(" · ")}</div>
              </div>
              <div className="arena-mini">
                <div className="mini-key">MENTAL STATE</div>
                <ul className="mini-bars">
                  {Object.entries(mental).filter(([k]) => k !== "volatility").map(([k, v]) => (
                    <li key={k} className="mini-bar">
                      <span className="mini-bar-name">{k.replace(/([A-Z])/g, " $1").toUpperCase()}</span>
                      <span className="mini-bar-track">
                        <span className="mini-bar-fill" style={{ width: `${(v * 100).toFixed(0)}%`, background: BRAND.primary }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>

          {/* chat panel */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title">MODELCHAT</div>
              <div className="arena-muted">type and press enter</div>
            </div>
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
                    <div className={`arena-bubble ${m.from === "user" ? "user" : "ai"}`}>
                      {m.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <form onSubmit={onSubmit} className="arena-form">
              <input
                ref={inputRef}
                type="text"
                placeholder={`MESSAGE ${AGENT.name}`}
                className="arena-input"
              />
              <button type="submit" className="arena-button">SEND</button>
            </form>
          </motion.div>
        </section>

        {/* right column: README + logs */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title">README.TXT</div>
              <div className="arena-tabs">
                <span className="arena-tab is-active">OVERVIEW</span>
              </div>
            </div>
            <div className="arena-readme">
              <p><b>Gargle Lab</b> is an always-on benchmark that feeds a single agent with structured noise and measures drift in real time.</p>
              <p>The metric tracked is the <b>Brainrot Index</b>, derived from tokens-per-minute over a sliding window. Mental state is inferred from level, delta, and short-term volatility.</p>
              <p>Markets test trading agents. Noise tests reasoning agents. Let’s see how far Gargle can go before he loses the plot.</p>
            </div>
          </motion.div>

          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title">LOGS</div>
              <div className="arena-tabs"><span className="arena-tab is-active">ALL</span></div>
            </div>
            <div ref={logsRef} className="arena-logs">
              <ul className="space-y-2 text-sm">
                {messages.map((m, i) => (
                  <li key={i} className={`arena-log ${m.from === "user" ? "feed" : "ai"}`}>
                    <span className="ts">{new Date(m.ts).toLocaleTimeString()}</span>
                    <span className="who">{m.from === "user" ? "FEED" : AGENT.name.toUpperCase()}</span>
                    <span className="text">{m.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </aside>
      </main>
    </div>
  );
}
