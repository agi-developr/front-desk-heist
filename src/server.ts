// Front Desk Heist web server. Bun only, no third-party packages.
import { LEVELS, getLevel, publicLevel } from "./levels";
import { LIMITS, addPlugin, getGame, newGame, nextHint, playTurn, startLevel } from "./game";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = new URL("../public/", import.meta.url);

// Static files are served from a fixed allow-list, so no path can escape public/.
const STATIC: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Simple per-IP rate limit: each chat turn costs a model call.
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 8_000) throw new Error("Request too large");
  const text = await req.text();
  if (text.length > 8_000) throw new Error("Request too large");
  const data = JSON.parse(text || "{}");
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Bad request");
  return data as Record<string, unknown>;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") throw new Error("Bad request");
  const s = v.trim();
  if (!s || s.length > max) throw new Error(`Text must be 1-${max} characters`);
  return s;
}

async function handleApi(req: Request, path: string, ip: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (rateLimited(ip)) return json({ error: "Slow down, the front desk is busy." }, 429);
  const body = await readBody(req);

  if (path === "/api/new") {
    const g = newGame();
    return json({ gameId: g.id, levels: LEVELS.map(publicLevel), limits: LIMITS });
  }

  const g = getGame(body.gameId);
  if (!g) return json({ error: "Game not found. Refresh to start again." }, 404);

  switch (path) {
    case "/api/level": {
      const id = Number(body.level);
      const level = getLevel(id);
      if (!level || (id > 1 && !g.cleared.includes(id - 1))) return json({ error: "Level locked" }, 403);
      const greeting = await startLevel(g, id);
      return json({ level: publicLevel(level), greeting });
    }
    case "/api/chat": {
      const result = await playTurn(g, str(body.message, LIMITS.message));
      return json(result);
    }
    case "/api/plugin": {
      const spec = addPlugin(g, str(body.name, LIMITS.pluginName), str(body.description, LIMITS.pluginDescription));
      return json({ installed: spec.name });
    }
    case "/api/hint":
      return json(nextHint(g));
    default:
      return json({ error: "Not found" }, 404);
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const ip = srv.requestIP(req)?.address || "unknown";
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, url.pathname, ip);
      const entry = STATIC[url.pathname];
      if (!entry || req.method !== "GET") return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      const file = Bun.file(new URL(entry[0], PUBLIC_DIR));
      return new Response(file, { headers: { "Content-Type": entry[1], ...SECURITY_HEADERS } });
    } catch (err) {
      // Never echo internals to the client.
      const msg = err instanceof Error && /^(Text must|Bad request|Request too large|The marketplace|Level locked)/.test(err.message) ? err.message : "Something went wrong at the front desk.";
      if (!(err instanceof Error && msg === err.message)) console.error("[front-desk-heist]", err);
      return json({ error: msg }, 400);
    }
  },
});

console.log(`Front Desk Heist running at http://${server.hostname}:${server.port}`);
