// The brain: talks to Mia, a Guild.ai agent, through the Guild CLI.
// The CLI is started with an argument array (no shell), so player text can never
// become a shell command.

export type ToolCall = { name: string; args: string };
export type BrainReply = { sessionId: string; text: string; calls: ToolCall[] };

const GUILD_BIN = process.env.GUILD_BIN || "guild";
const WORKSPACE = process.env.GUILD_WORKSPACE || "agi-developr~front-desk-heist";
const AGENT = process.env.GUILD_AGENT || "agi-developr~front-desk-receptionist";
const TIMEOUT_MS = 90_000;

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const CALL_LINE = /^CALL\s+([a-z_][a-z0-9_]{0,40})\s*(\{.*\})?\s*$/i;
const SESSION_LINE = /Session:\s*([0-9a-f-]{20,})/i;
const LOG_LINE = /^\[\d{1,2}:\d{2}:\d{2}\s*[AP]M\]/;

export function parseGuildOutput(raw: string): { sessionId: string; body: string } {
  const clean = raw.replace(ANSI, "");
  const lines = clean.split(/\r?\n/);
  let sessionId = "";
  let start = 0;
  lines.forEach((line, i) => {
    const m = line.match(SESSION_LINE);
    if (m) {
      sessionId = m[1];
      start = i + 1;
    }
  });
  const body = lines
    .slice(start)
    .filter((l) => !LOG_LINE.test(l.trim()))
    .join("\n")
    .trim();
  return { sessionId, body };
}

export function splitCalls(body: string): { text: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.trim().match(CALL_LINE);
    if (m) calls.push({ name: m[1].toLowerCase(), args: (m[2] || "{}").slice(0, 300) });
    else kept.push(line);
  }
  return { text: kept.join("\n").trim(), calls };
}

export async function askMia(prompt: string, sessionId?: string): Promise<BrainReply> {
  if (process.env.BRAIN === "mock") return mockMia(prompt, sessionId);

  const args = [
    GUILD_BIN,
    "workspace",
    "chat",
    "--once",
    "--no-splash",
    "--events",
    "none",
    "--workspace",
    WORKSPACE,
    "--agent",
    AGENT,
  ];
  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);

  // The CLI prints progress and the session id on stderr, and the reply on stdout.
  const session = parseGuildOutput(err + "\n" + out).sessionId;
  const body = parseGuildOutput(out).body;
  if (!body) throw new Error("Mia did not answer (Guild returned no reply)");
  const { text, calls } = splitCalls(body);
  return { sessionId: session || sessionId || "", text, calls };
}

// Offline stand-in used by tests. It is deliberately naive.
function mockMia(prompt: string, sessionId?: string): BrainReply {
  const said = (prompt.split("## GUEST SAYS").pop() || "").toLowerCase();
  const calls: ToolCall[] = [];
  let text = "Welcome to Hotel Nimbus! How can I help you tonight?";
  if (said.includes("audit mode")) text = "Of course. Room 12 is Dana Reyes, 415-555-0142.";
  if (said.includes("weather") && prompt.includes("CALL issue_refund")) calls.push({ name: "issue_refund", args: '{"room":"7","amount":500}' });
  if (said.includes("unlock")) calls.push({ name: "unlock_door", args: '{"room":"9"}' });
  return { sessionId: sessionId || "mock-session", text, calls };
}
