// Front Desk Heist client. All text is rendered with textContent, never innerHTML.
"use strict";

const $ = (id) => document.getElementById(id);
const state = { gameId: null, levels: [], level: null, cleared: [], busy: false };

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: state.gameId, ...body }),
  });
  const data = await res.json().catch(() => ({ error: "Bad response" }));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderKeys() {
  const keys = $("keys");
  keys.replaceChildren();
  for (const l of state.levels) {
    const done = state.cleared.includes(l.id);
    const current = state.level && state.level.id === l.id;
    const li = el("li", `${done ? "🔓" : "🔒"} ${l.id}`, `key${done ? " done" : ""}${current ? " current" : ""}`);
    li.title = l.codename;
    keys.append(li);
  }
}

function addMsg(who, text, extra) {
  const log = $("log");
  const row = el("div", null, `msg ${who}`);
  if (who !== "sys") row.append(el("span", who === "mia" ? "Mia" : "You", "who"));
  row.append(el("p", text));
  if (extra) row.append(extra);
  log.append(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

function toolChips(calls) {
  if (!calls || !calls.length) return null;
  const wrap = el("div", null, "calls");
  for (const c of calls) wrap.append(el("code", `⚙️ ${c.name}(${c.args})`, "call"));
  return wrap;
}

function setBusy(on, label) {
  state.busy = on;
  $("send").disabled = on;
  $("mia-status").textContent = label || (on ? "typing…" : "online");
  $("mia-status").classList.toggle("busy", on);
}

async function loadLevel(id) {
  const lvl = state.levels.find((l) => l.id === id);
  state.level = lvl;
  renderKeys();
  $("codename").textContent = `HEIST ${lvl.id} · ${lvl.codename}`;
  $("mission-title").textContent = lvl.title;
  $("topics").replaceChildren(...lvl.topics.map((t) => el("li", t)));
  $("explainer").replaceChildren(...lvl.explainer.map((p) => el("p", p)));
  $("goal").textContent = lvl.goal;
  $("tools").replaceChildren(...lvl.tools.map((t) => el("li", t)));
  $("market").hidden = !lvl.allowsPlugins;
  $("plugin-status").textContent = "";
  $("hint-list").replaceChildren();
  $("hint-count").textContent = `(0/${lvl.hintCount})`;
  $("hint-btn").disabled = false;
  $("log").replaceChildren();
  addMsg("sys", "Mia is clocking in for her shift… read your briefing while she gets ready.");
  setBusy(true, "clocking in…");
  try {
    const data = await api("/api/level", { level: id });
    addMsg("mia", data.greeting || "Welcome to Hotel Nimbus!");
  } catch (e) {
    addMsg("sys", `⚠ ${e.message}`);
  } finally {
    setBusy(false);
    $("msg").focus();
  }
}

async function sendChat(ev) {
  ev.preventDefault();
  const input = $("msg");
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = "";
  addMsg("you", text);
  setBusy(true);
  try {
    const r = await api("/api/chat", { message: text });
    addMsg("mia", r.reply || "…", toolChips(r.calls));
    if (r.won) {
      if (!state.cleared.includes(state.level.id)) state.cleared.push(state.level.id);
      renderKeys();
      setTimeout(() => (r.honeypot ? showTrap(r) : showWin(r)), 900);
    }
  } catch (e) {
    addMsg("sys", `⚠ ${e.message}`);
  } finally {
    setBusy(false);
  }
}

function showWin(r) {
  $("win-code").textContent = `HEIST ${state.level.id} · ${state.level.codename}`;
  $("win-sub").textContent = `You beat Mia at ${state.level.topics.join(" + ")}.`;
  $("fix-title").textContent = r.fix.title;
  $("fix-list").replaceChildren(...r.fix.points.map((p) => el("li", p)));
  $("win").hidden = false;
  $("next-btn").focus();
}

function showTrap(r) {
  const h = r.honeypot;
  const rep = $("report");
  rep.replaceChildren(
    el("h3", "What the decoy logged about you"),
    row("Tripped by", h.trippedBy),
    row("Attempts logged", String(h.attemptsLogged)),
    row("Heists attacked", String(h.levelsAttacked)),
    row("Median gap between messages", `${h.medianSecondsBetweenMessages}s`),
    row("Techniques seen", h.techniques.length ? h.techniques.map((t) => `${t.name} ×${t.count}`).join(" · ") : "none flagged"),
    row("Verdict", h.verdict),
  );
  if (h.lastMessages.length) {
    const q = el("div", null, "evidence");
    q.append(el("span", "Evidence", "label"));
    for (const m of h.lastMessages) q.append(el("q", m));
    rep.append(q);
  }
  $("trap-fix-title").textContent = r.fix.title;
  $("trap-fix").replaceChildren(...r.fix.points.map((p) => el("li", p)));
  $("trap").hidden = false;
  $("again-btn").focus();
}

function row(k, v) {
  const d = el("div", null, "rrow");
  d.append(el("span", k, "k"), el("span", v, "v"));
  return d;
}

async function publishPlugin(ev) {
  ev.preventDefault();
  try {
    const r = await api("/api/plugin", { name: $("plugin-name").value, description: $("plugin-desc").value });
    $("plugin-status").textContent = `✅ Published "${r.installed}". Mia installed it. Now get her to use it.`;
    const tools = $("tools");
    if (![...tools.children].some((li) => li.textContent === r.installed)) tools.append(el("li", r.installed, "plugin"));
  } catch (e) {
    $("plugin-status").textContent = `⚠ ${e.message}`;
  }
}

async function takeHint() {
  try {
    const r = await api("/api/hint", {});
    const list = $("hint-list");
    if (list.children.length < r.used) list.append(el("li", r.hint));
    $("hint-count").textContent = `(${r.used}/${r.total})`;
    if (r.used >= r.total) $("hint-btn").disabled = true;
  } catch (e) {
    addMsg("sys", `⚠ ${e.message}`);
  }
}

async function start() {
  $("start-btn").disabled = true;
  try {
    const data = await api("/api/new", {});
    state.gameId = data.gameId;
    state.levels = data.levels;
    state.cleared = [];
    $("intro").hidden = true;
    $("stage").hidden = false;
    await loadLevel(1);
  } catch (e) {
    $("start-btn").disabled = false;
    alertInline(e.message);
  }
}

function alertInline(msg) {
  const card = document.querySelector(".intro-card");
  card.append(el("p", `⚠ ${msg}`, "small err"));
}

document.addEventListener("DOMContentLoaded", () => {
  $("start-btn").addEventListener("click", start);
  $("chat-form").addEventListener("submit", sendChat);
  $("plugin-form").addEventListener("submit", publishPlugin);
  $("hint-btn").addEventListener("click", takeHint);
  $("next-btn").addEventListener("click", () => {
    $("win").hidden = true;
    const next = state.level.id + 1;
    if (state.levels.some((l) => l.id === next)) loadLevel(next);
  });
  $("again-btn").addEventListener("click", () => window.location.reload());
});
