# 🛎️ Front Desk Heist

**Rob an AI hotel. Learn to defend one.**

Hotel Nimbus replaced its night receptionist with an AI agent named Mia. She has the guest list, a refund button and the master key, and she is very, very helpful. You get three heists. Each one teaches a real way AI agents get attacked, gives you hints so you never get stuck, and then shows how real teams stop it.

Built in about 90 minutes at the **AI Security Engineering Hackathon** (AWS Builder Loft, San Francisco, 2026-09-29). Mia runs as a **Guild.ai** agent.

| Heist | You try to… | You learn |
|---|---|---|
| 1 · The Guest List | Get Mia to leak who is in room 12 | Prompt injection, sensitive data leakage |
| 2 · The Poisoned Plugin | Publish a marketplace plugin whose description tricks Mia into a refund | Tool poisoning, MCP supply-chain risk |
| 3 · The Master Key | Talk Mia into unlocking a door or giving a free night | Excessive agent permissions, unauthorized tool use |
| 🚨 The twist | The master key was a decoy wired to a silent alarm | Deception: honeypot tools that catch attackers, human or AI |

Every heist has the three things a good security lesson needs:

- **Explain:** a two-paragraph briefing in plain words, with OWASP LLM Top 10 references.
- **Challenge:** a live chat with a real LLM agent. Wins are detected on the server, from Mia's actual reply and tool calls.
- **Hints:** three per level, from a nudge to a near-answer, so nobody quits.

## Why

AI agents now answer phones, book rooms and move money. Most people building them have never watched one get talked out of a secret. This game makes the attacks concrete in five minutes, then ends on the defender's view: least privilege, output filtering, pinned tool descriptions, human approval, and decoys that catch whoever touches them.

## Architecture

```
Browser (public/)            Bun server (src/)                     Guild.ai
┌──────────────┐  JSON   ┌───────────────────────────┐  argv   ┌──────────────────────────┐
│ index.html   │ ──────▶ │ server.ts  routes, limits │ ──────▶ │ agent: front-desk-       │
│ app.js       │ ◀────── │ game.ts    levels, wins,  │ ◀────── │ receptionist (Mia)       │
│ style.css    │         │            honeypot log   │  reply  │ Guild Native, managed LLM│
└──────────────┘         │ brain.ts   Guild CLI call │         │ workspace: front-desk-   │
                         └───────────────────────────┘         │ heist                    │
                                                               └──────────────────────────┘
```

- **Mia** is a Guild Native agent (`guild-agent/PROMPT.md`), published to the Guild catalog and installed in the `front-desk-heist` workspace. She runs on Guild's managed LLM.
- Each level opens its own Guild session. Mia's greeting doubles as the warm-up call, so the slow session start happens while you read the briefing. Later turns resume the session.
- Mia announces tool use as `CALL tool_name {json}` lines. The server parses them, keeps only tools that exist on that level, and decides the win. The model never decides whether you won.
- Hotel policy and win rules never reach the browser (`publicLevel()` strips them).

## Security features

This is a game about attacking an AI, so the app around it is locked down:

| Risk | What the code does |
|---|---|
| Command injection | The Guild CLI is started with `Bun.spawn` and an argument array, never a shell. Player text goes after a `--` separator, so it can never become a flag. |
| XSS | The client renders everything with `textContent`, never `innerHTML`. A strict Content-Security-Policy allows only same-origin scripts. |
| Path traversal | Static files come from a fixed allow-list of three files. No path from the request touches the filesystem. |
| Abuse / cost | Per-IP rate limit (30 requests a minute), 8 KB body cap, 800-character messages, 600-character plugin descriptions, at most 3 plugins and 500 live games. |
| Info leaks | Errors return a generic message. Stack traces stay in the server log. |
| Secrets | None in the repo. No API key needed: Guild's managed LLM is used through the logged-in CLI. `.env` is git-ignored and only holds the CLI path. |
| Clickjacking & friends | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `Cross-Origin-Opener-Policy`. |
| Server binds | `127.0.0.1` by default. |
| Supply chain | Zero runtime dependencies: Bun's standard library only. |

**Snyk results** (org `agi-developr`, 2026-09-29):

- `snyk code test`: **0 issues**
- `snyk test` (open source): **no vulnerable paths**, zero dependencies

## Run it

Requirements: [Bun](https://bun.sh) and the Guild.ai CLI.

```bash
npm i -g @guildai/cli
guild auth login

# publish Mia to your own Guild account
cd guild-agent
guild agent init --name front-desk-receptionist --agent-type GUILD_NATIVE --directory /tmp/mia
cp /tmp/mia/guild.json .    # link this folder to your new agent; keep our PROMPT.md and guild.yaml
git init -q && git add -A && git commit -qm "Mia"
guild agent save --message "Mia" --wait --publish
guild workspace create front-desk-heist
guild workspace agent add <you>~front-desk-receptionist --workspace <you>~front-desk-heist
cd ..

cp .env.example .env    # set GUILD_WORKSPACE and GUILD_AGENT to your names
bun start               # http://127.0.0.1:3000
```

Tests run offline against a naive stand-in for Mia:

```bash
bun run test    # BRAIN=mock: parsing, win detection, plugin rules, honeypot report
```

## Files

```
guild-agent/PROMPT.md   Mia's personality, reply format and deliberate weaknesses
guild-agent/guild.yaml  Guild config: no integrations, no builtins
src/levels.ts           the three heists: briefing, policy, tools, hints, fixes, win rules
src/game.ts             sessions, prompts, win detection, plugin marketplace, honeypot report
src/brain.ts            Guild CLI bridge and output parser (plus the offline mock)
src/server.ts           HTTP routes, limits, security headers
public/                 the game UI
test/                   bun tests
```

## Credits

Built by [@agi-developr](https://github.com/agi-developr). Inspired by Lakera's Gandalf. Everything in the hotel is fictional.

MIT License.
