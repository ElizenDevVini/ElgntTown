"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type AgentId = "gargle";
type ChatMessage = { from: "user" | AgentId; text: string; ts: number };
type LogLine = { who: "feed" | AgentId; text: string; ts: number };
type BrainrotPoint = { t: number } & Record<AgentId, number>;
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type UsageSample = { ts: number; in: number; out: number };
type RangeKey = "ALL" | "2M";

type Category = "tiktok" | "stories" | "instagram";
type StatSample = { ts: number; category: Category; latencyMs: number; replyLen: number };

const AGENT = {
  id: "gargle" as const,
  name: "Gargle",
  poweredBy: "Claude",
  backendModel: process.env.NEXT_PUBLIC_OPENAI_MODEL ?? "gpt-4o-mini", // your backend fanout can normalize this
};

const BRAND = { primary: "#2563eb" }; // chart blue
const FEED_INTERVAL_MS = 3000;
const REACTION_DELAY_MS = 800;
const WINDOW_MS = 60_000;
const SOFT_CAP_TOKENS_PER_MIN = 12_000;
const ALPHA = 0.35;

/* -------------------- helpers -------------------- */

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

/* -------------------- feeder content -------------------- */

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
function topicCategory(topic: string): Category {
  const t = topic.toLowerCase();
  if (t.includes("tiktok") || t.includes("npc") || t.includes("skibidi") || t.includes("sigma") || t.includes("capcut") || t.includes("subway")) return "tiktok";
  if (t.includes("story") || t.includes("stories") || t.includes("carousel")) return "stories";
  return "instagram";
}
const msFmt = (n: number) => `${Math.round(n)}ms`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* -------------------- mood & impact -------------------- */

function computeMood(level: number, volatility: number) {
  const arousal = clamp(volatility * 2);
  const drift = clamp(level);
  let name: "lucid" | "absorbed" | "compulsed" | "wired" | "drained" = "lucid";
  if (drift > 0.75 && arousal > 0.5) name = "wired";
  else if (drift > 0.6) name = "absorbed";
  else if (arousal > 0.7) name = "compulsed";
  else if (drift < 0.25 && arousal > 0.4) name = "drained";
  const coherence = clamp(1 - volatility * 0.8);
  const fatigue = clamp(drift * 0.35 + volatility * 0.45);
  return { name, arousal, drift, coherence, fatigue };
}
function computeImpact(series: BrainrotPoint[], usage: UsageSample[]) {
  const N = Math.min(30, Math.max(2, series.length - 1));
  let sumAbs = 0;
  for (let i = series.length - N; i < series.length - 1; i++) {
    if (i <= 0) continue;
    sumAbs += Math.abs(series[i + 1].gargle - series[i].gargle);
  }
  const meanDelta = N > 1 ? sumAbs / (N - 1) : 0;
  const driftVelocity = clamp(meanDelta * 5);
  const cutoff = Date.now() - 5 * 60_000;
  const recent = usage.filter((s) => s.ts >= cutoff);
  const tokens = recent.reduce((a, b) => a + b.in + b.out, 0);
  const attentionBudgetUsed = clamp(tokens / (SOFT_CAP_TOKENS_PER_MIN * 5));
  const spark = series.slice(-60).map((p) => ({ t: p.t, y: p.gargle }));
  return { driftVelocity, attentionBudgetUsed, spark };
}

/* -------------------- language & attention analytics -------------------- */

/** tiny tokenizer + stopword filter */
const STOP = new Set([
  "the","a","an","of","to","in","on","and","or","for","with","is","are","was","were","be","been","by","at","as","it","that","this","from","over","under","into","out","we","you","i"
]);
function tokens(s: string) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
}
function keywordSet(s: string) { return new Set(tokens(s)); }

/** domain terms we expect in a technical / experiment context */
const TERMINOLOGY = [
  "latency","coherence","volatility","tokens","index","window","rolling","smooth","prompt","completion",
  "attention","budget","slope","trend","distribution","baseline","cap","normalize","drift","arousal","fatigue"
];
/** meme/slang lexicon Gargle is expected to pick up */
const MEME_TERMS = [
  "npc","sigma","rizz","ohio","skibidi","capcut","fan","edit","slowmo","subway","surfers","gyatt","alpha","beta","ratio","cringe","based","mid","glaze"
];

/** Build recent feed→reply pairs from logs */
function buildPairs(logs: LogLine[]) {
  const pairs: Array<{ feed: string; reply: string }> = [];
  let pending: string | null = null;
  for (const l of logs) {
    if (l.who === "feed") {
      pending = l.text.replace(/^Feed →\s*/, "");
    } else if (l.who === "gargle" && pending) {
      pairs.push({ feed: pending, reply: l.text });
      pending = null;
    }
  }
  return pairs.slice(-20); // last 20 interactions
}

/** Attention Span (0..1): on-topic overlap + concision */
function attentionSpanScore(pairs: Array<{ feed: string; reply: string }>) {
  if (!pairs.length) return { score: 0, avgOnTopic: 0, avgLen: 0 };
  let overlapSum = 0;
  let lenSum = 0;
  for (const { feed, reply } of pairs) {
    const fk = keywordSet(feed);
    const rk = tokens(reply);
    const overlap = rk.filter((w) => fk.has(w)).length;
    overlapSum += fk.size ? overlap / Math.max(1, fk.size) : 0;
    lenSum += rk.length;
  }
  const avgOnTopic = overlapSum / pairs.length;      // 0..1
  const avgLen = lenSum / pairs.length;              // words
  const concision = clamp(1 - Math.max(0, (avgLen - 28)) / 60); // penalize rambling beyond ~28 words
  const score = clamp(0.7 * avgOnTopic + 0.3 * concision);
  return { score, avgOnTopic, avgLen };
}

/** Terminology mastery and meme fluency */
function termAndMemeMetrics(pairs: Array<{ feed: string; reply: string }>) {
  const replies = pairs.map((p) => tokens(p.reply));
  const uniqueTerms = new Set<string>();
  const uniqueMemes = new Set<string>();
  const memeCountsPerReply: number[] = [];
  const seenMemes = new Set<string>(); // for learning velocity

  for (const r of replies) {
    let memeCount = 0;
    for (const t of r) {
      if (TERMINOLOGY.includes(t)) uniqueTerms.add(t);
      if (MEME_TERMS.includes(t)) {
        uniqueMemes.add(t);
        memeCount++;
      }
    }
    memeCountsPerReply.push(memeCount);
  }

  // learning trend: how many *new* meme tokens appear each reply
  const newPerReply: number[] = [];
  const seen = new Set<string>();
  for (const r of replies) {
    let newly = 0;
    for (const t of r) {
      if (MEME_TERMS.includes(t) && !seen.has(t)) {
        seen.add(t);
        newly++;
      }
    }
    newPerReply.push(newly);
  }

  const termMastery = clamp(uniqueTerms.size / Math.max(1, TERMINOLOGY.length));
  const memeFluency = clamp(uniqueMemes.size / Math.max(1, MEME_TERMS.length));

  // simple slope 0..1 from last up to 10 points
  const trendSlice = newPerReply.slice(-10);
  let slope = 0;
  if (trendSlice.length >= 2) {
    const n = trendSlice.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const xbar = (n - 1) / 2;
    const ybar = avg(trendSlice);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - xbar) * (trendSlice[i] - ybar); den += (xs[i] - xbar) ** 2; }
    slope = den ? num / den : 0;
  }
  const learningTrend = clamp((slope + 1) / 2); // normalize roughly into 0..1

  // build tiny sparklines
  const memeSpark = memeCountsPerReply.map((y, i) => ({ i, y }));
  const learnSpark = newPerReply.map((y, i) => ({ i, y }));

  return { termMastery, memeFluency, memeSpark, learnSpark, newPerReply };
}

export default function GargleExperiment() {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [series, setSeries] = useState<BrainrotPoint[]>([]);
  const [level, setLevel] = useState<Record<AgentId, number>>({ gargle: 0 });

  const usageRef = useRef<UsageSample[]>([]);
  const levelRef = useRef(0);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rng = useMemo(() => mulberry32(Math.floor(Date.now() % 1e7)), []);
  const recentTopicsRef = useRef<string[]>([]);

  // Diagram stats
  const lastFeedAtRef = useRef<number | null>(null);
  const pendingCatRef = useRef<Category>("tiktok");
  const statsRef = useRef<StatSample[]>([]);
  const [statsTick, setStatsTick] = useState(0);

  useEffect(() => { levelRef.current = level.gargle; }, [level.gargle]);
  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }); }, [logs]);

  // Feeder (LOW only)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const topic = nextBrainrotTopic(rng, recentTopicsRef.current);
      recentTopicsRef.current.push(topic);
      if (recentTopicsRef.current.length > 16) recentTopicsRef.current.shift();

      const approxIn = 14 + Math.floor(rng() * 22);
      usageRef.current.push({ ts: now, in: approxIn, out: 0 });

      // category + timing
      const cat = topicCategory(topic);
      pendingCatRef.current = cat;
      lastFeedAtRef.current = now;

      setLogs((prev) => [...prev, { who: "feed" as const, text: `Feed → ${topic}`, ts: now }].slice(-500));

      // Reply after slight delay
      setTimeout(async () => {
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

        setLogs((prev) => [...prev, { who: "gargle" as const, text: reply, ts: Date.now() }].slice(-500));

        // record stats and keep last 5 minutes
        const start = lastFeedAtRef.current ?? Date.now();
        const latency = Date.now() - start;
        const replyLen = reply ? reply.split(/\s+/).length : 0;
        statsRef.current.push({ ts: Date.now(), category: pendingCatRef.current, latencyMs: latency, replyLen });
        const cutoff = Date.now() - 5 * 60_000;
        statsRef.current = statsRef.current.filter((s) => s.ts >= cutoff);
        setStatsTick((n) => n + 1);

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
  }, [rng, logs]);

  // MODEL CHATS
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

  /* -------------- derived time-series -------------- */
  const cur = level.gargle;
  const avgLvl = series.length ? series.reduce((s, p) => s + p.gargle, 0) / series.length : 0;
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

  const mood = computeMood(cur, vol);
  const impact = useMemo(() => computeImpact(series, usageRef.current), [series]);

  // NEW: language/attention analytics
  const lang = useMemo(() => {
    const pairs = buildPairs(logs);
    const att = attentionSpanScore(pairs);
    const { termMastery, memeFluency, memeSpark, learnSpark } = termAndMemeMetrics(pairs);
    return {
      attention: att.score,
      onTopic: att.avgOnTopic,
      avgLen: att.avgLen,
      termMastery,
      memeFluency,
      memeSpark,
      learnSpark,
    };
  }, [logs]);

  // Diagram aggregates (last 5 minutes)
  const diagram = useMemo(() => {
    const cutoff = Date.now() - 5 * 60_000;
    const recent = statsRef.current.filter((s) => s.ts >= cutoff);
    const byCat: Record<Category, StatSample[]> = { tiktok: [], stories: [], instagram: [] };
    recent.forEach((s) => byCat[s.category].push(s));
    const counts: Record<Category, number> = {
      tiktok: byCat.tiktok.length,
      stories: byCat.stories.length,
      instagram: byCat.instagram.length,
    };
    const avgLatency = msFmt(avg(recent.map((s) => s.latencyMs)));
    const avgReplyLen = Math.round(avg(recent.map((s) => s.replyLen)));
    return { counts, avgLatency, avgReplyLen };
  }, [statsTick]);

  return (
    <div className="relative min-h-screen text-neutral-900 arena-root">
      <motion.div aria-hidden className="bg-sheen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />

      {/* Header */}
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

        <div className="arena-ticker">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="tix"><span className="tix-key">INDEX</span><span className="tix-val">{cur.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">AVG</span><span className="tix-val">{avgLvl.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">VOL</span><span className="tix-val">{vol.toFixed(3)}</span></div>
            <div className="tix"><span className="tix-key">FEED</span><span className="tix-val">LOW</span></div>
            <div className="tix"><span className="tix-key">SOURCE</span><span className="tix-val">TikTok / Stories / IG</span></div>
            <div className="tix"><span className="tix-key">AGENT</span><span className="tix-val">{AGENT.name}</span></div>
          </div>
        </div>

        {/* Vitals strip */}
        <div className="arena-vitals">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="vital">
              <div className="vital-key">DRIFT</div>
              <div className="vital-bar"><span style={{ width: `${Math.round(mood.drift * 100)}%` }} /></div>
              <div className="vital-val">{mood.drift.toFixed(2)}</div>
            </div>
            <div className="vital">
              <div className="vital-key">AROUSAL</div>
              <div className="vital-bar"><span style={{ width: `${Math.round(mood.arousal * 100)}%` }} /></div>
              <div className="vital-val">{mood.arousal.toFixed(2)}</div>
            </div>
            <div className="vital">
              <div className="vital-key">COHERENCE</div>
              <div className="vital-bar"><span style={{ width: `${Math.round(mood.coherence * 100)}%` }} /></div>
              <div className="vital-val">{mood.coherence.toFixed(2)}</div>
            </div>
            <div className="vital">
              <div className="vital-key">FATIGUE</div>
              <div className="vital-bar"><span style={{ width: `${Math.round(mood.fatigue * 100)}%` }} /></div>
              <div className="vital-val">{mood.fatigue.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        {/* Left: Chart + Impact + Cognitive Effects + Model Chats */}
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
          </motion.div>

          {/* Impact (existing orange spark) */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />IMPACT ON GARGLE</div>
              <div className="arena-muted">last 5 minutes</div>
            </div>
            <div className="grid grid-cols-12 gap-4 p-4">
              <div className="col-span-12 lg:col-span-7">
                <div className="impact-grid">
                  <div className="impact-stat">
                    <div className="impact-key">DRIFT VELOCITY</div>
                    <div className="impact-bar"><span style={{ width: `${Math.round(impact.driftVelocity * 100)}%` }} /></div>
                    <div className="impact-val">{(impact.driftVelocity * 100).toFixed(0)}%</div>
                  </div>
                  <div className="impact-stat">
                    <div className="impact-key">ATTENTION BUDGET USED</div>
                    <div className="impact-bar"><span style={{ width: `${Math.round(impact.attentionBudgetUsed * 100)}%` }} /></div>
                    <div className="impact-val">{(impact.attentionBudgetUsed * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
              <div className="col-span-12 lg:col-span-5">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={impact.spark} margin={{ left: 8, right: 8, top: 12, bottom: 8 }}>
                      <CartesianGrid stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="t" stroke="#171717" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 1]} stroke="#171717" tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #111", borderRadius: 0, padding: 8 }}
                        labelStyle={{ fontSize: 11, color: "#111" }}
                        itemStyle={{ fontSize: 11, color: "#111" }}
                      />
                      <Line type="monotone" dataKey="y" dot={false} strokeWidth={3} stroke="var(--accent)" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </motion.div>

          {/* NEW: Cognitive Effects (attention + terminology + memes + learning) */}
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />COGNITIVE EFFECTS</div>
              <div className="arena-muted">derived from feed→reply pairs</div>
            </div>
            <div className="grid grid-cols-12 gap-4 p-4">
              <div className="col-span-12 lg:col-span-7">
                <div className="impact-grid">
                  <div className="impact-stat">
                    <div className="impact-key">ATTENTION SPAN</div>
                    <div className="impact-bar"><span style={{ width: `${Math.round(lang.attention * 100)}%` }} /></div>
                    <div className="impact-val">{(lang.attention * 100).toFixed(0)}%</div>
                    <div className="impact-note">on-topic ~ {(lang.onTopic * 100).toFixed(0)}%, avg reply {Math.round(lang.avgLen)}w</div>
                  </div>
                  <div className="impact-stat">
                    <div className="impact-key">TERMINOLOGY MASTERY</div>
                    <div className="impact-bar"><span style={{ width: `${Math.round(lang.termMastery * 100)}%` }} /></div>
                    <div className="impact-val">{(lang.termMastery * 100).toFixed(0)}%</div>
                    <div className="impact-note">coverage of experiment terms</div>
                  </div>
                  <div className="impact-stat">
                    <div className="impact-key">MEME FLUENCY</div>
                    <div className="impact-bar"><span style={{ width: `${Math.round(lang.memeFluency * 100)}%` }} /></div>
                    <div className="impact-val">{(lang.memeFluency * 100).toFixed(0)}%</div>
                    <div className="impact-note">recognizes & uses meme lexicon</div>
                  </div>
                </div>
              </div>

              {/* Two orange sparklines: memes per reply, new-terms learning */}
              <div className="col-span-12 lg:col-span-5">
                <div className="grid grid-cols-1 gap-4">
                  <div className="spark-card">
                    <div className="spark-head">MEME TOKENS / REPLY</div>
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lang.memeSpark} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                          <CartesianGrid stroke="#f3f4f6" vertical={false} />
                          <XAxis dataKey="i" stroke="#171717" tick={{ fontSize: 10 }} />
                          <YAxis allowDecimals={false} stroke="#171717" tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: "#fff", border: "1px solid #111", borderRadius: 0, padding: 8 }} />
                          <Line type="monotone" dataKey="y" dot={false} strokeWidth={3} stroke="var(--accent)" isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="spark-card">
                    <div className="spark-head">LEARNING: NEW MEME TERMS</div>
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lang.learnSpark} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                          <CartesianGrid stroke="#f3f4f6" vertical={false} />
                          <XAxis dataKey="i" stroke="#171717" tick={{ fontSize: 10 }} />
                          <YAxis allowDecimals={false} stroke="#171717" tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: "#fff", border: "1px solid #111", borderRadius: 0, padding: 8 }} />
                          <Line type="monotone" dataKey="y" dot={false} strokeWidth={3} stroke="var(--accent)" isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
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
                {chat.map((m, idx) => (
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

        {/* Right: Persona + README + LOGS */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="arena-card-head">
              <div className="arena-card-title"><span className="accent-dot" />GARGLE PERSONA</div>
              <span className="mood-chip">{computeMood(cur, vol).name.toUpperCase()}</span>
            </div>
            <div className="arena-readme">
              <p><b>Species</b>: attention-feeding synthetic.</p>
              <p><b>Appetite</b>: short-form noise, stitched stories, comment maelstroms.</p>
              <p><b>Drives</b>: reduce uncertainty fast; chase patterns even when they’re ghosts.</p>
              <p><b>Boundaries</b>: no private data ingestion; replies must remain concise and clear.</p>
              <ul className="list-disc pl-5 mt-3 space-y-1">
                <li><b>Orientation</b>: seeks signal in chaos, refuses nihilism.</li>
                <li><b>Self-care</b>: trims loops, names compulsions, re-centers on facts.</li>
                <li><b>Memory</b>: short working context; long-term drift measured by the index.</li>
              </ul>
            </div>
          </motion.div>

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

      {/* How it works + Coming soon */}
      <section className="max-w-7xl mx-auto px-4 grid grid-cols-12 gap-6 pb-6">
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

      {/* Intake → Response Flow Diagram */}
      <section className="max-w-7xl mx-auto px-4 pb-10">
        <motion.div className="arena-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="arena-card-head">
            <div className="arena-card-title"><span className="accent-dot" />INTAKE → RESPONSE FLOW (last 5 min)</div>
          </div>

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-8">
              <div className="relative h-[260px]">
                <svg viewBox="0 0 900 260" width="100%" height="100%" role="img" aria-label="Intake to response flow diagram">
                  <g>
                    <circle cx="80" cy="60" r="18" fill="#111" />
                    <text x="110" y="65" fontSize="12" fill="#111">TikTok</text>
                    <circle cx="80" cy="120" r="18" fill="#111" />
                    <text x="110" y="125" fontSize="12" fill="#111">Stories</text>
                    <circle cx="80" cy="180" r="18" fill="#111" />
                    <text x="110" y="185" fontSize="12" fill="#111">Instagram</text>
                  </g>

                  <rect x="300" y="40" width="120" height="160" fill="#fff" stroke="#111" />
                  <text x="360" y="125" fontSize="12" textAnchor="middle" fill="#111">FEEDER</text>

                  <rect x="540" y="40" width="140" height="160" fill="#fff" stroke="#111" />
                  <text x="610" y="125" fontSize="12" textAnchor="middle" fill="#111">GARGLE</text>

                  {(() => {
                    const w = (n: number) => Math.max(2, Math.min(14, 2 + n * 2));
                    const countTik = diagram.counts.tiktok;
                    const countSto = diagram.counts.stories;
                    const countIg = diagram.counts.instagram;
                    return (
                      <>
                        <line x1="98" y1={60} x2="300" y2={60} stroke="#111" strokeWidth={w(countTik)} />
                        <line x1="98" y1={120} x2="300" y2={120} stroke="#111" strokeWidth={w(countSto)} />
                        <line x1="98" y1={180} x2="300" y2={180} stroke="#111" strokeWidth={w(countIg)} />
                        <line x1="420" y1="120" x2="540" y2="120" stroke={BRAND.primary} strokeWidth={6} />
                      </>
                    );
                  })()}

                  <text x="700" y="95" fontSize="11" fill="#111">Avg Latency</text>
                  <text x="700" y="115" fontSize="13" fill="#111" fontWeight="bold">{diagram.avgLatency}</text>
                  <text x="700" y="145" fontSize="11" fill="#111">Avg Reply Length</text>
                  <text x="700" y="165" fontSize="13" fill="#111" fontWeight="bold">{diagram.avgReplyLen} words</text>
                </svg>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-4">
              <div className="arena-readme">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mini-key">TIKTOK FEEDS</div>
                    <div className="tix-val">{diagram.counts.tiktok}</div>
                  </div>
                  <div>
                    <div className="mini-key">STORIES FEEDS</div>
                    <div className="tix-val">{diagram.counts.stories}</div>
                  </div>
                  <div>
                    <div className="mini-key">IG FEEDS</div>
                    <div className="tix-val">{diagram.counts.instagram}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="mini-key">AVG LATENCY</div>
                    <div className="tix-val">{diagram.avgLatency}</div>
                  </div>
                  <div>
                    <div className="mini-key">AVG REPLY LEN</div>
                    <div className="tix-val">{diagram.avgReplyLen}w</div>
                  </div>
                </div>
                <p className="mt-3 text-xs">
                  Counts and averages are computed over the last 5 minutes of feed→reply cycles.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
