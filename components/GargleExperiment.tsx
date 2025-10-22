"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type AgentId = "gargle";
type Message = { from: "user" | AgentId; text: string; ts: number };
type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type Intensity = "low" | "medium" | "high";
type RangeKey = "ALL" | "2M";

const AGENT = {
  id: "gargle" as const,
  name: "Gargle",
  poweredBy: "Claude",          // label only; backend can still be OpenAI-normalized
  backendModel: "gpt-4o-mini",
};

const BRAND = { primary: "#2563eb" }; // keep your blue

// --- metrics/tunables ---
const WINDOW_MS = 60_000;
const SOFT_CAP_TOKENS_PER_MIN = 12_000;
const ALPHA = 0.35;
const FEED_INTERVAL_MS = 3000;  // slowed down
const REACTION_DELAY_MS = 800;  // small delay before Gargle replies to feed

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
  const fragments = [
    "drift detected", "context window saturated", "signal chasing",
    "pattern echo", "semantic blur", "topic hop", "overfit loop",
  ];
  const pick = () => fragments[Math.floor(rng() * fragments.length)];
  const base = prompt.split(/\s+/).slice(0, Math.max(4, Math.floor(12 - brainrot * 6))).join(" ");
  const tail = Array.from({ length: Math.max(1, Math.floor(brainrot * 3)) }).map(pick).join(" · ");
  const derail = Math.random() < brainrot * 0.6 ? ` | ${pick()} > ${pick()}` : "";
  return `Gargle: ${base} — ${tail}${derail}`.trim();
}

// Feeds emphasizing TikTok/stories/IG doomscrolling
const FEEDS = {
  low: [
    "short-form clips (safe cuts) from TikTok",
    "light meme summaries from stories",
    "casual reels digests",
  ],
  medium: [
    "brainrot TikTok clips",
    "brainrot stories chains",
    "mid-speed doomscrolling on Instagram explore",
  ],
  high: [
    "aggressive doomscrolling on Instagram comments",
    "out-of-context TikTok mashups",
    "looping bait claims + stitched rants",
  ],
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
  return { focusDrift, coherence, anxiety, curiosity, stability, fatigue, volatility };
}

export default function GargleExperiment() {
  // ---- state (declare once) -------------------------------------------------
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [messages, setMessages] = useState<Message[]>([]);
  const [series, setSeries] = useState<BrainrotPoint[]>([]);
  const [level, setLevel] = useState<Record<AgentId, number>>({ gargle: 0 });
  const [range, setRange] = useState<RangeKey>("ALL"); // <-- only declaration

  // ---- refs/helpers ---------------------------------------------------------
  const usageRef = useRef<UsageSample[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const rng = useMemo(() => mulberry32(Math.floor(Date.now() % 1e7)), []);
  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // Append a feed line and ensure Gargle replies after a short delay
  const appendFeedWithReply = (topic: string, nowTs: number) => {
    setMessages((prev) => {
      const next: Message[] = [...prev, { from: "user" as const, text: `Feed → ${topic}`, ts: nowTs }];
      return next.slice(-350);
    });
    setTimeout(() => {
      const brainrot = level.gargle;
      const reaction = simulatedResponse(rng, topic, brainrot);
      const approxOut = Math.max(8, Math.ceil(reaction.split(/\s+/).length * 1.3));
      usageRef.current.push({ ts: Date.now(), in: 6, out: approxOut });
      setMessages((prev) => {
        const next: Message[] = [...prev, { from: "gargle" as const, text: reaction, ts: Date.now() }];
        return next.slice(-350);
      });
    }, REACTION_DELAY_MS);
  };

  // Feeder loop (slow cadence)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const bucket = FEEDS[intensity];
      const topic = bucket[Math.floor(rng() * bucket.length)];

      const approxIn = 16 + Math.floor(rng() * (intensity === "high" ? 120 : intensity === "medium" ? 64 : 28));
      usageRef.current.push({ ts: now, in: approxIn, out: 0 });

      appendFeedWithReply(topic, now);

      const idx = computeIndex(usageRef.current, now);
      setLevel((prev) => ({ gargle: clamp(prev.gargle * (1 - ALPHA) + idx * ALPHA) }));
      setSeries((prev) => {
        const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
        return [...prev, { t, gargle: level.gargle }].slice(-360);
      });
    }, FEED_INTERVAL_MS);
    return () => clearInterval(id);
  }, [intensity, rng, level.gargle]);

  // MODEL CHATS (talk to Gargle)
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

  // Derived metrics + range
  const mental = useMemo(() => computeMentalState(series.map((p) => p.gargle)), [series]);
  const cur = level.gargle;
  const avg = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
  const vol = mental.volatility ?? 0;

  const displaySeries = useMemo(() => {
    if (range === "ALL") return series;
    return series.slice(-120); // ~2 minutes
  }, [series, range]);

  const lastVal = displaySeries.length ? displaySeries[displaySeries.length - 1].gargle : 0;

  // ------------------------ UI ------------------------
  return (
    <div className="relative min-h-screen text-neutral-900 arena-root">
      <motion.div aria-hidden className="bg-sheen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />

      {/* Header with LIVE only */}
      <header className="arena-top">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-baseline gap-3">
              <div className="arena-logo">Gargle Lab</div>
              <nav className="arena-nav hidden md:flex">
                <a className="is-active">LIVE</a>
              </nav>
            </div>
            <div className="arena-actions hidden md:flex">
              <span className="arena-chip">Powered by {AGENT.poweredBy}</span>
            </div>
          </div>
        </div>

        {/* Ticker */}
        <div className="arena-ticker">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="tix"><span className="tix-key">INDEX</span><span className="tix-val">{cur.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">AVG</span><span className="tix-val">{avg.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">VOL</span><span className="tix-val">{vol.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">INTENSITY</span><span className="tix-val">{intensity.toUpperCase()}</span></div>
            <div className="tix"><span className="tix-key">FEEDS</span><span className="tix-val">{FEEDS[intensity].length}</span></div>
            <div className="tix"><span className="tix-key">AGENT</span><span className="tix-val">{AGENT.name}</span></div>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        <section className="col-span-12 lg:col-span-8 space-y-6">
          {/* Chart */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />TOTAL BRAINROT</div>
              <div className="arena-tabs">
                <button className={`arena-tab ${range === "ALL" ? "is-active" : ""}`} onClick={() => setRange("ALL")}>ALL</button>
                <button className={`arena-tab ${range === "2M" ? "is-active" : ""}`} onClick={() => setRange("2M")}>2M</button>
              </div>
            </div>
            <div className="relative h-[420px]">
              <div className="absolute right-4 top-4 arena-float-tag">
                <span className="dot" style={{ background: BRAND.primary }} />
                <span className="dot" style={{ background: "var(--accent)" }} />
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
                  <Line type="monotone" dataKey="gargle" dot={false} strokeWidth={3} stroke={BRAND.primary} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Controls + mental state */}
            <div className="arena-subgrid">
              <div className="arena-mini">
                <div className="mini-key">FEED INTENSITY</div>
                <div className="mini-controls">
                  {(["low", "medium", "high"] as const).map((lvl) => (
                    <button key={lvl} onClick={() => setIntensity(lvl)}
                      className={`mini-pill ${intensity === lvl ? "is-on" : ""}`}>
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

          {/* MODEL CHATS */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />MODEL CHATS</div>
              <div className="arena-muted">talk to Gargle — press Enter</div>
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
              <input ref={inputRef} type="text" placeholder={`MESSAGE ${AGENT.name}`} className="arena-input" />
              <button type="submit" className="arena-button">SEND</button>
            </form>
          </motion.div>
        </section>

        {/* Right: README + Logs */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />README.TXT</div>
              <div className="arena-tabs"><span className="arena-tab is-active">OVERVIEW</span></div>
            </div>
            <div className="arena-readme">
              <p><b>Gargle Lab</b> benchmarks a single agent exposed to noisy social inputs.</p>
              <p>Feeds emphasize <b>brainrot TikTok clips</b>, <b>brainrot stories</b>, and <b>doomscrolling on Instagram</b>. The <b>Brainrot Index</b> derives from tokens/min over a sliding window; mental state is inferred from level, delta, and short-term volatility.</p>
              <p>Server should return <code>{'{ choices[0].message.content, usage }'}</code> in OpenAI format.</p>
            </div>
          </motion.div>

          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />LOGS</div>
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
