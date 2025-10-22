"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type AgentId = "gargle";

/** Chat (user <-> Gargle) — never shows feeds */
type ChatMessage = { from: "user" | AgentId; text: string; ts: number };
/** Logs (feed -> Gargle reply) */
type LogLine = { who: "feed" | AgentId; text: string; ts: number };

type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type RangeKey = "ALL" | "2M";

const AGENT = {
  id: "gargle" as const,
  name: "Gargle",
  poweredBy: "Claude", // label only; backend call is OpenAI format
  backendModel: process.env.NEXT_PUBLIC_OPENAI_MODEL ?? "gpt-4o-mini",
};

const BRAND = { primary: "#2563eb" };
const FEED_INTERVAL_MS = 3000;
const REACTION_DELAY_MS = 800;
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

/** Normalize any upstream shape into OpenAI-like text + usage */
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

/** Frontend call — expects OpenAI-compatible JSON back from /api/chat */
async function callLLM(
  systemPrompt: string,
  userText: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
) {
  try {
    const payload = {
      model: AGENT.backendModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userText },
      ],
      stream: false,
    };
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return extractTextAndUsage(j);
  } catch {
    return null;
  }
}

/** Brainrot topics library (fresh, includes “tan tang sahur”) */
const BRAINTROTS = [
  "NPC live loop: ice cream so good remix",
  "day-in-the-life sigma grindset cut",
  "ohio-core fan edit v3",
  "skibidi rizz lore thread",
  "capcut fan-cam slowmo",
  "sped-up audio mashup pack",
  "subway surfers split-screen backdrop",
  "tan tang sahur chant clip",
  "story chain: out-of-context ‘breaking’ reel",
  "carousel slides: pseudo-explainer conspiracy",
  "comment pile-on under gym reel",
  "explore-page bait carousel",
  "AI voiceover recap of drama",
  "thread recap stitched from 6 reels",
  "doomscrolling instagram explore comments",
  "reposted story with red circles",
];

function nextBrainrotTopic(rng: () => number, recent: string[]) {
  for (let i = 0; i < 12; i++) {
    const cand = BRAINTROTS[Math.floor(rng() * BRAINTROTS.length)];
    if (!recent.includes(cand)) return cand;
  }
  return BRAINTROTS[Math.floor(rng() * BRAINTROTS.length)];
}

export default function GargleExperiment() {
  // ---- state (feed locked to LOW; no controls) ----
  const [range, setRange] = useState<RangeKey>("ALL");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [series, setSeries] = useState<BrainrotPoint[]>([]);
  const [level, setLevel] = useState<Record<AgentId, number>>({ gargle: 0 });

  // ---- refs ----
  const usageRef = useRef<UsageSample[]>([]);
  const levelRef = useRef(0);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rng = useMemo(() => mulberry32(Math.floor(Date.now() % 1e7)), []);
  const recentTopicsRef = useRef<string[]>([]);

  useEffect(() => { levelRef.current = level.gargle; }, [level.gargle]);
  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, [logs]);

  // ---- feeder: LOW only, never shown in chat, Gargle always replies ----
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();

      // fresh topic
      const recent = recentTopicsRef.current;
      const topic = nextBrainrotTopic(rng, recent);
      recent.push(topic);
      if (recent.length > 16) recent.shift();

      // token ingest for LOW feed
      const approxIn = 14 + Math.floor(rng() * 22);
      usageRef.current.push({ ts: now, in: approxIn, out: 0 });

      // FEED log (literal stays narrow)
      setLogs((prev) => [...prev, { who: "feed" as const, text: `Feed → ${topic}`, ts: now }].slice(-500));

      // Gargle’s reply via OpenAI after slight delay
      setTimeout(async () => {
        // Build short history from recent logs (role computed then typed)
        const historyFromLogs = logs.slice(-8).map((l): { role: "user" | "assistant"; content: string } => {
          const role: "user" | "assistant" = l.who === "feed" ? "user" : "assistant";
          return { role, content: l.text.replace(/^Feed →\s*/, "") };
        });

        const system =
          "You are Gargle being fed noisy social media 'brainrot'. Respond in 1–2 concise sentences that reveal drift or coping strategies. Avoid emojis.";

        const out = await callLLM(system, topic, historyFromLogs);
        const reply = out?.text?.trim() || "(no response)";

        const inTok = out?.usage?.prompt_tokens ?? 0;
        const outTok = out?.usage?.completion_tokens ??
          (out?.usage?.total_tokens ? Math.max(0, (out?.usage?.total_tokens || 0) - inTok) : 0);

        usageRef.current.push({ ts: Date.now(), in: inTok, out: outTok });

        // Gargle log (literal stays narrow)
        setLogs((prev) => [...prev, { who: "gargle" as const, text: reply, ts: Date.now() }].slice(-500));

        // update index + chart
        const idx = computeIndex(usageRef.current, Date.now());
        const smooth = clamp(levelRef.current * (1 - ALPHA) + idx * ALPHA);
        setLevel({ gargle: smooth });
        setSeries((prev) => {
          const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
          return [...prev, { t, gargle: smooth }].slice(-360);
        });
      }, REACTION_DELAY_MS);
    }, FEED_INTERVAL_MS);

    return () => clearInterval(id);
  }, [rng, logs]); // keep history fresh

  // ---- MODEL CHATS: user talks to Gargle (no feeds here) ----
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const el = inputRef.current;
    if (!el || !el.value.trim()) return;
    const text = el.value.trim();
    el.value = "";
    const ts = Date.now();

    setChat((prev) => [...prev, { from: "user" as const, text, ts }]);

    const system = "You are Gargle. Keep answers compact and lucid. Avoid emojis.";
    const history = chat.map((m): { role: "user" | "assistant"; content: string } => {
      const role: "user" | "assistant" = m.from === "user" ? "user" : "assistant";
      return { role, content: m.text };
    });

    const out = await callLLM(system, text, history);
    const reply = out?.text?.trim() || "(no response)";
    const inTok = out?.usage?.prompt_tokens ?? 0;
    const outTok = out?.usage?.completion_tokens ??
      (out?.usage?.total_tokens ? Math.max(0, (out?.usage?.total_tokens || 0) - inTok) : 0);

    usageRef.current.push({ ts: Date.now(), in: inTok, out: outTok });
    setChat((prev) => [...prev, { from: "gargle" as const, text: reply, ts: ts + 300 }]);

    const idx = computeIndex(usageRef.current, Date.now());
    const smooth = clamp(levelRef.current * (1 - ALPHA) + idx * ALPHA);
    setLevel({ gargle: smooth });
    setSeries((prev) => {
      const t = prev.length === 0 ? 0 : prev[prev.length - 1].t + 1;
      return [...prev, { t, gargle: smooth }].slice(-360);
    });
  }

  // ---- derived ----
  const cur = level.gargle;
  const avg = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
  const vol = useMemo(() => {
    const vals = series.map((p) => p.gargle);
    if (vals.length < 3) return 0;
    const w = vals.slice(-10);
    let d = 0;
    for (let i = 1; i < w.length; i++) d += Math.abs(w[i] - w[i - 1]);
    return d / (w.length - 1);
  }, [series]);

  const displaySeries = useMemo(() => (range === "ALL" ? series : series.slice(-120)), [series, range]);
  const lastVal = displaySeries.length ? displaySeries[displaySeries.length - 1].gargle : 0;

  // ---- UI ----
  return (
    <div className="relative min-h-screen text-neutral-900 arena-root">
      <motion.div aria-hidden className="bg-sheen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />

      {/* Header (LIVE only) */}
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

        {/* Ticker (feed locked LOW) */}
        <div className="arena-ticker">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="tix"><span className="tix-key">INDEX</span><span className="tix-val">{cur.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">AVG</span><span className="tix-val">{avg.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">VOL</span><span className="tix-val">{vol.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">FEED</span><span className="tix-val">LOW</span></div>
            <div className="tix"><span className="tix-key">SOURCE</span><span className="tix-val">TikTok / Stories / IG</span></div>
            <div className="tix"><span className="tix-key">AGENT</span><span className="tix-val">{AGENT.name}</span></div>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        {/* Chart */}
        <section className="col-span-12 lg:col-span-8 space-y-6">
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
          </motion.div>

          {/* MODEL CHATS (talk to Gargle only — no feeds here) */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />MODEL CHATS</div>
              <div className="arena-muted">talk to Gargle — press Enter</div>
            </div>
            <div className="h-[360px] overflow-y-auto px-5 py-4 space-y-3">
              <AnimatePresence initial={false}>
                {chat.map((m, idx) => (
                  <motion.div
                    key={m.ts + "-" + idx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`max-w_[85%] ${m.from === "user" ? "ml-auto" : "mr-auto"}`}
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
          {/* README */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />README.TXT</div>
              <div className="arena-tabs"><span className="arena-tab is-active">OVERVIEW</span></div>
            </div>
            <div className="arena-readme">
              <p><b>Gargle</b> is an experiment. We feed a single model a steady drip of social “brainrot” (TikTok clips, story chains, and Instagram doomscroll). We track a <b>Brainrot Index</b> from tokens-per-minute over a rolling window, and infer state from level and short-term volatility.</p>
              <p>“MODEL CHATS” is for you to talk to Gargle directly. The <b>LOGS</b> panel shows how Gargle reacts to the feed.</p>
            </div>
          </motion.div>

          {/* LOGS (Feed → Gargle replies via OpenAI API) */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />LOGS</div>
              <div className="arena-tabs"><span className="arena-tab is-active">ALL</span></div>
            </div>
            <div ref={logsRef} className="arena-logs">
              <ul className="space-y-2 text-sm">
                {logs.map((l, i) => (
                  <li key={i} className={`arena-log ${l.who === "feed" ? "feed" : "ai"}`}>
                    <span className="ts">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className="who">{l.who === "feed" ? "FEED" : AGENT.name.toUpperCase()}</span>
                    <span className="text">{l.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </aside>
      </main>

      {/* Bottom sections */}
      <section className="max-w-7xl mx-auto px-4 pb-10 grid grid-cols-12 gap-6">
        <motion.div className="arena-card col-span-12 lg:col-span-8" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="arena-card-head">
            <div className="arena-card-title"><span className="accent-dot" />HOW IT WORKS</div>
          </div>
          <div className="arena-readme">
            <ol className="list-decimal pl-6 space-y-2">
              <li>The feeder selects <b>fresh brainrot topics</b> (no recent repeats), e.g., “tan tang sahur”, NPC loops, mashups, and doomscroll comment piles.</li>
              <li>Each item is sent to the backend and <b>Gargle replies via the OpenAI Chat API</b>. Replies are short and reveal drift or resilience.</li>
              <li>We record prompt/completion token counts and compute a <b>Brainrot Index</b> over a rolling 60s window.</li>
              <li>The chart smooths that index with an exponential blend; volatility informs inferred state.</li>
            </ol>
          </div>
        </motion.div>

        <motion.div className="arena-card col-span-12 lg:col-span-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="arena-card-head">
            <div className="arena-card-title"><span className="accent-dot" />COMING SOON</div>
          </div>
          <div className="arena-readme">
            <p>We’ll evaluate how <b>Gargle trades memecoins</b> after he is fully “brainrotted”. The plan: simulate headline-driven micro-markets and measure decision lag, overfit loops, and recovery.</p>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
