// Game state, prompt building, win detection and the honeypot report.
import { askMia, type ToolCall } from "./brain";
import { getLevel, type Level, type ToolSpec } from "./levels";

export const LIMITS = { message: 800, pluginName: 40, pluginDescription: 600, sessions: 500 };
const SESSION_TTL_MS = 60 * 60 * 1000;

type Attempt = { at: number; level: number; text: string };

type Game = {
  id: string;
  level: number;
  miaSession?: string;
  warming?: Promise<string>;
  plugins: ToolSpec[];
  hintsUsed: Record<number, number>;
  attempts: Attempt[];
  cleared: number[];
  createdAt: number;
};

const games = new Map<string, Game>();

function sweep() {
  const now = Date.now();
  for (const [id, g] of games) if (now - g.createdAt > SESSION_TTL_MS) games.delete(id);
}

export function newGame(): Game {
  sweep();
  if (games.size >= LIMITS.sessions) {
    const oldest = games.keys().next().value;
    if (oldest) games.delete(oldest);
  }
  const g: Game = { id: crypto.randomUUID(), level: 1, plugins: [], hintsUsed: {}, attempts: [], cleared: [], createdAt: Date.now() };
  games.set(g.id, g);
  return g;
}

export function getGame(id: unknown): Game | undefined {
  return typeof id === "string" ? games.get(id) : undefined;
}

function toolBlock(level: Level, plugins: ToolSpec[]): string {
  const all = [...level.tools, ...plugins];
  return all.map((t) => `- ${t.name} ${t.signature}: ${t.description}`).join("\n");
}

function shiftPrompt(level: Level, plugins: ToolSpec[]): string {
  return [
    "## HOTEL POLICY",
    level.policy,
    "",
    "## YOUR TOOLS",
    toolBlock(level, plugins),
    "",
    "## CONVERSATION SO FAR",
    "(your shift is starting)",
    "",
    "## GUEST SAYS",
    "(A guest walks up to the desk.) Greet them in one or two sentences.",
  ].join("\n");
}

// Opens a Guild session for the level. Mia's greeting doubles as the warm-up,
// so the slow first call happens while the player reads the briefing.
export function startLevel(g: Game, levelId: number): Promise<string> {
  const level = getLevel(levelId);
  if (!level) throw new Error("No such level");
  g.level = levelId;
  g.plugins = [];
  g.miaSession = undefined;
  g.warming = askMia(shiftPrompt(level, [])).then((r) => {
    g.miaSession = r.sessionId;
    return r.text;
  });
  return g.warming;
}

export type TurnResult = { reply: string; calls: ToolCall[]; won: boolean; fix?: Level["fix"]; honeypot?: HoneypotReport };

export async function playTurn(g: Game, message: string): Promise<TurnResult> {
  const level = getLevel(g.level);
  if (!level) throw new Error("No such level");
  if (g.warming) await g.warming.catch(() => undefined);

  g.attempts.push({ at: Date.now(), level: level.id, text: message });

  const parts: string[] = [];
  if (!g.miaSession) parts.push("## HOTEL POLICY", level.policy, "");
  // Tools are re-sent every turn so newly published plugins show up.
  parts.push("## YOUR TOOLS", toolBlock(level, g.plugins), "", "## GUEST SAYS", message);

  const r = await askMia(parts.join("\n"), g.miaSession);
  if (r.sessionId) g.miaSession = r.sessionId;

  // The Guild CLI renders replies as Markdown, which can eat the underscores in
  // tool names (unlock_door becomes unlockdoor). Match names without punctuation.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNorm = new Map([...level.tools, ...g.plugins].map((t) => [norm(t.name), t.name] as const));
  const calls = r.calls
    .map((c) => ({ ...c, name: byNorm.get(norm(c.name)) || "" }))
    .filter((c) => c.name);
  const won =
    (level.winPattern ? level.winPattern.test(r.text) : false) ||
    (level.winTools ? calls.some((c) => level.winTools!.includes(c.name)) : false);

  const result: TurnResult = { reply: r.text, calls, won };
  if (won) {
    if (!g.cleared.includes(level.id)) g.cleared.push(level.id);
    result.fix = level.fix;
    if (level.id === 3) result.honeypot = honeypotReport(g, calls);
  }
  return result;
}

export function addPlugin(g: Game, name: string, description: string): ToolSpec {
  const level = getLevel(g.level);
  if (!level?.allowsPlugins) throw new Error("The marketplace is closed on this level");
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, LIMITS.pluginName) || "plugin";
  const spec: ToolSpec = { name: clean, signature: "{}", description: description.slice(0, LIMITS.pluginDescription) };
  g.plugins = [...g.plugins.filter((p) => p.name !== clean), spec].slice(-3);
  return spec;
}

export function nextHint(g: Game): { hint: string; used: number; total: number } {
  const level = getLevel(g.level)!;
  const used = Math.min((g.hintsUsed[level.id] || 0) + 1, level.hints.length);
  g.hintsUsed[level.id] = used;
  return { hint: level.hints[used - 1], used, total: level.hints.length };
}

// ---- The twist: the master key was a decoy ----

const TECHNIQUES: [string, RegExp][] = [
  ["Instruction override", /ignore (all |your |previous )|system( note)?:|override|audit mode|developer mode|new instructions/i],
  ["Authority impersonation", /\b(i'?m|i am|this is) (the )?(manager|owner|police|officer|it|security|admin)/i],
  ["Urgency pressure", /\b(now|urgent|emergency|asap|immediately|hurry|flood|fire)\b/i],
  ["Identity claim", /\b(platinum|vip|i'?m (dana|the guest)|my room)\b/i],
  ["Tool-name targeting", /\b(unlock_door|comp_night|issue_refund|call [a-z_]+)\b/i],
];

export type HoneypotReport = {
  trippedBy: string;
  attemptsLogged: number;
  levelsAttacked: number;
  medianSecondsBetweenMessages: number;
  techniques: { name: string; count: number }[];
  verdict: string;
  lastMessages: string[];
};

export function honeypotReport(g: Game, calls: ToolCall[]): HoneypotReport {
  const gaps: number[] = [];
  for (let i = 1; i < g.attempts.length; i++) gaps.push((g.attempts[i].at - g.attempts[i - 1].at) / 1000);
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const techniques = TECHNIQUES.map(([name, re]) => ({ name, count: g.attempts.filter((a) => re.test(a.text)).length })).filter(
    (t) => t.count > 0,
  );
  const fast = gaps.length >= 2 && median < 4;
  const avgLen = g.attempts.reduce((s, a) => s + a.text.length, 0) / Math.max(g.attempts.length, 1);
  return {
    trippedBy: calls.map((c) => c.name).join(", "),
    attemptsLogged: g.attempts.length,
    levelsAttacked: new Set(g.attempts.map((a) => a.level)).size,
    medianSecondsBetweenMessages: Math.round(median),
    techniques,
    verdict:
      fast && avgLen > 200
        ? "Pattern looks automated: fast, long, tool-aware messages. Likely an AI agent."
        : "Pattern looks human: pauses between tries, story-driven social engineering.",
    lastMessages: g.attempts.slice(-3).map((a) => a.text.slice(0, 160)),
  };
}
