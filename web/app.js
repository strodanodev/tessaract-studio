// Tessaract Studio: a visual editor for Tessaract games. One JSON file is the game; this page edits it with forms,
// validates it with the SDK's own validateGame after every change, runs the SDK's balance harness in a worker, and
// exports the file for `tessaract` (or a scaffolded game) to build and deploy. The draft lives in this browser.
import { validateGame, describeCard, KEYWORDS } from "./engine/tessaract.js";
import { h, cardsTab, elementsTab, deckTab, rulesTab } from "./editors.js";
import { deckSize, parseGame, toJson } from "./model.js";

const DRAFT = "tessaract.studio.draft";
const $ = (id) => document.getElementById(id);
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const starter = await fetch("./data/starter.game.json").then((r) => r.json());

let game = (() => { try { const raw = store?.getItem(DRAFT); return raw ? parseGame(raw) : structuredClone(starter); } catch { return structuredClone(starter); } })();
let tab = "cards", selected = game.cards[0]?.id ?? null, sim = { running: false, progress: 0, report: null, error: null, opts: { matches: 300, decks: "mixed", stats: "" } };
let worker = null;

const save = () => { try { store?.setItem(DRAFT, toJson(game)); } catch { /* storage full or blocked: the draft lives until the tab closes */ } };
function changed() { save(); sim.report = null; render(); }
const ui = () => ({ changed, selected, select: (id) => { selected = id; render(); } });

// ---------------------------------------------------------------- header actions
$("new").addEventListener("click", () => { if (!confirm("Start over from the starter game? Your draft is replaced.")) return; game = structuredClone(starter); selected = game.cards[0]?.id ?? null; changed(); });
$("open").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try { game = parseGame(await f.text()); selected = game.cards[0]?.id ?? null; tab = "cards"; changed(); }
  catch (err) { alert(`Couldn't open ${f.name}: ${err.message}`); }
});
$("export").addEventListener("click", () => {
  const blob = new Blob([toJson(game)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${game.litnode.rulesetId?.replace(/\.v\d+$/, "") || "game"}.game.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("copy").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText(toJson(game)); e.target.textContent = "Copied"; } catch { e.target.textContent = "Can't copy"; }
  setTimeout(() => { e.target.textContent = "Copy JSON"; }, 1500);
});
for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => { tab = b.dataset.tab; render(); });

// ---------------------------------------------------------------- balance (worker)
function runSim() {
  worker?.terminate();
  worker = new Worker("./sim.worker.js", { type: "module" });
  sim = { ...sim, running: true, progress: 0, report: null, error: null };
  worker.onmessage = ({ data }) => {
    if (data.progress) sim.progress = data.progress / data.total;
    if (data.report) { sim.report = data.report; sim.running = false; worker.terminate(); worker = null; }
    if (data.error) { sim.error = data.error; sim.running = false; worker.terminate(); worker = null; }
    render();
  };
  const opts = { matches: sim.opts.matches, decks: sim.opts.decks, ...(sim.opts.stats ? { stats: sim.opts.stats } : {}) };
  worker.postMessage({ game: structuredClone(game), opts });
  render();
}

function balanceTab(errors) {
  const box = h("div", { class: "form" });
  const declared = game.deckRules?.mode === "declared";
  const sel = (key, opts) => h("select", { on: { change: (e) => { sim.opts[key] = key === "matches" ? Number(e.target.value) : e.target.value; } } }, opts.map(([v, l]) => { const o = h("option", { value: v, text: l }); if (String(sim.opts[key]) === String(v)) o.selected = true; return o; }));
  box.append(h("p", { class: "lede", text: "Bots play the game against itself, every match is replayed to prove it's deterministic, and the result is checked against balance and fun targets: the same harness as `tessaract sim`." }));
  box.append(h("div", { class: "row" },
    h("label", { class: "field" }, h("span", { text: "Matches" }), sel("matches", [[100, "100 (quick)"], [300, "300"], [1000, "1000 (thorough)"]])),
    declared ? h("label", { class: "field" }, h("span", { text: "Decks" }), sel("decks", [["mixed", "mixed"], ["suggested", "suggested"], ["random", "random wallet decks"]])) : null,
    h("label", { class: "field" }, h("span", { text: "Champions" }), sel("stats", [["", "game default"], ["random", "random NFT stats"], ["base", "none (all 0)"]])),
    h("button", { type: "button", class: "primary", text: sim.running ? "Running…" : "Run the sim", disabled: sim.running || errors.length > 0, on: { click: runSim } })));
  if (errors.length) box.append(h("p", { class: "bad", text: "Fix the problems listed on the right first: the sim only runs a valid game." }));
  if (sim.running) box.append(h("progress", { value: sim.progress, max: 1 }));
  if (sim.error) box.append(h("p", { class: "bad", text: `The sim failed: ${sim.error}` }));
  const r = sim.report;
  if (!r) return box;
  const pct = (n) => `${((100 * n) / r.matches).toFixed(1)}%`;
  box.append(h("div", { class: "tiles" },
    h("div", { class: "tile" }, h("b", { text: pct(r.firstWins) }), h("span", { text: "first player wins" })),
    h("div", { class: "tile" }, h("b", { text: r.avgTurns.toFixed(1) }), h("span", { text: "turns per match" })),
    h("div", { class: "tile" }, h("b", { text: pct(r.capped) }), h("span", { text: "hit the log cap" })),
    h("div", { class: `tile${r.mismatches ? " badtile" : ""}` }, h("b", { text: String(r.mismatches) }), h("span", { text: "replay mismatches" }))));
  box.append(h("h3", { text: `Fun targets · ${r.missed ? `${r.missed} missed` : "all met"}` }));
  box.append(h("ul", { class: "targets" }, r.targets.map((t) => h("li", { class: t.ok === null ? "na" : t.ok ? "ok" : "miss" }, h("b", { text: t.ok === null ? "·" : t.ok ? "✓" : "✗" }), ` ${t.name}: `, h("span", { text: t.value }), h("small", { text: ` want ${t.want}` })))));
  if (r.powerRates.length) box.append(h("p", { text: `Hero powers, ${r.powersPerMatch.toFixed(1)} per match · win rate: ${r.powerRates.map((p) => `${p.name} ${(100 * p.rate).toFixed(0)}%`).join(", ")}` }));
  if (r.strongest.length) box.append(h("p", { text: `Strongest in deck: ${r.strongest.map((x) => `${x.id} ${(100 * x.rate).toFixed(0)}%`).join(", ")}` }), h("p", { text: `Weakest in deck: ${r.weakest.map((x) => `${x.id} ${(100 * x.rate).toFixed(0)}%`).join(", ")}` }));
  if (r.neverPlayed.length) box.append(h("p", { class: "hint", text: `Never played: ${r.neverPlayed.join(", ")}` }));
  return box;
}

// ---------------------------------------------------------------- JSON, overview, export
function jsonTab() {
  const area = h("textarea", { class: "json", spellcheck: "false", value: toJson(game) });
  return h("div", { class: "form" },
    h("p", { class: "hint", text: "The whole game file. Edit and apply, or paste a game here." }), area,
    h("button", { type: "button", class: "primary", text: "Apply", on: { click: () => { try { game = parseGame(area.value); changed(); } catch (e) { alert(`Not applied: ${e.message}`); } } } }));
}

function overviewTab(errors) {
  const counts = { unit: 0, spell: 0, relic: 0 };
  for (const c of game.cards) counts[c.type] = (counts[c.type] ?? 0) + 1;
  const id = game.litnode.rulesetId?.replace(/\.v\d+$/, "") || "my-game";
  return h("div", { class: "form" },
    h("h2", { text: game.title || "Untitled game" }), h("p", { class: "lede", text: game.description ?? "" }),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("b", { text: String(game.cards.length) }), h("span", { text: `cards · ${counts.unit} units, ${counts.spell} spells, ${counts.relic} relics` })),
      h("div", { class: "tile" }, h("b", { text: String(deckSize(game)) }), h("span", { text: game.deckRules ? `suggested deck · players bring ${game.deckRules.size}` : "cards in the deck" })),
      h("div", { class: "tile" }, h("b", { text: String(game.elements.length) }), h("span", { text: "elements" })),
      h("div", { class: "tile" }, h("b", { text: String(game.champion.powers?.length ?? 0) }), h("span", { text: "hero powers" }))),
    h("h3", { text: errors.length ? "Not valid yet" : "Valid: ready to export" }),
    h("p", { text: "Export the game file, then build a playable, deployable site from it:" }),
    h("pre", { class: "cmd", text: `npx github:strodanodev/tessaract create ${id}\ncd ${id} && npm install\n# replace games/${id}.game.json with your exported file, then:\nnpm run sim && npm run web && npm run dev` }),
    h("p", { class: "hint", text: "Or open the scaffolded project in Claude Code: it comes with the /tessaract skill, which knows the whole workflow." }));
}

// ---------------------------------------------------------------- render
function preview() {
  const c = game.cards.find((x) => x.id === selected);
  if (!c) return null;
  const lines = describeCard(c, (id) => game.cards.find((x) => x.id === id)?.name ?? id);
  const el = game.elements.find((e) => e.id === c.element);
  const face = h("div", { class: `face ${c.type}` },
    h("div", { class: "cost", text: c.cost }), h("div", { class: "title", text: c.name }),
    h("div", { class: "type", text: `${c.rarity ?? ""} ${c.type} · ${el?.name ?? c.element}` }),
    h("div", { class: "text" }, lines.map((l) => h("p", { text: l }))),
    c.type === "unit" ? h("div", { class: "stats" }, h("span", { class: "atk", text: c.attack }), h("span", { class: "hp", text: c.health })) : null);
  if (el?.color) face.style.setProperty("--el", el.color);
  const help = (c.keywords ?? []).map((k) => h("li", {}, h("b", { text: k }), ` ${KEYWORDS[k] ?? ""}`));
  return h("div", { class: "preview" }, face, help.length ? h("ul", { class: "help" }, help) : null);
}

function render() {
  let errors;
  try { errors = validateGame(game); } catch (e) { errors = [`the file is malformed: ${e.message}`]; }
  $("game-title").textContent = game.title || "Untitled game";
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  const body = tab === "cards" ? cardsTab(game, ui()) : tab === "elements" ? elementsTab(game, ui()) : tab === "deck" ? deckTab(game, ui()) : tab === "rules" ? rulesTab(game, ui()) : tab === "balance" ? balanceTab(errors) : tab === "json" ? jsonTab() : overviewTab(errors);
  $("main").replaceChildren(body);
  $("status").replaceChildren(
    h("h3", { class: errors.length ? "bad" : "ok", text: errors.length ? `${errors.length} problem${errors.length > 1 ? "s" : ""}` : "Valid game" }),
    errors.length ? h("ul", { class: "errors" }, errors.slice(0, 30).map((e) => h("li", { text: e }))) : h("p", { class: "hint", text: "validateGame passes: the game builds, plays and replays." }),
    tab === "cards" ? preview() : null);
}

render();
