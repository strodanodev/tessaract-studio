// The editing screens. Every field writes straight into the game object and calls `changed()`; the app then
// re-validates, saves the draft and re-renders. All text goes in through textContent or input values.
import { OPS, AUTOMATIC, KEYWORDS, TRIGGERS, describeCard } from "./engine/tessaract.js";
import { CHAMPION_FIELDS, RARITIES, RULE_FIELDS, STATS, TYPES, addCard, deckSize, duplicateCard, effectDefaults, removeCard, renameCard, setCopies, uniqueId } from "./model.js";

/** h("div", { class, text, on: { click } }, ...children) */
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = String(v);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "value") e.value = String(v);
    else if (k === "checked") e.checked = !!v;
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const field = (label, input, hint) => h("label", { class: "field" }, h("span", { text: label }), input, hint ? h("small", { text: hint }) : null);
const num = (value, onInput, min, max) => h("input", { type: "number", value, min, max, step: 1, on: { change: (e) => onInput(Number(e.target.value)) } });
const text = (value, onInput, attrs = {}) => h("input", { type: "text", value: value ?? "", ...attrs, on: { change: (e) => onInput(e.target.value) } });
const select = (value, options, onInput) => h("select", { on: { change: (e) => onInput(e.target.value) } }, options.map(([v, label]) => { const o = h("option", { value: v, text: label }); if (v === value) o.selected = true; return o; }));

/**
 * An effect editor. `ctx.chosen`: a target can be picked in this context (spells, powers, play abilities);
 * `ctx.onUnit`: the effect belongs to a unit (so "this" is allowed).
 */
export function effectEditor(game, effect, set, changed, ctx) {
  const def = OPS[effect.op];
  const box = h("div", { class: "effect" });
  box.append(field("Effect", select(effect.op, Object.keys(OPS).map((o) => [o, o]), (op) => { set(effectDefaults(op, game)); changed(); })));
  const put = (k, v) => { effect[k] = v; changed(); };
  if ("amount" in effect || ["damage", "heal", "draw", "energy"].includes(effect.op)) box.append(field("Amount", num(effect.amount ?? 1, (v) => put("amount", v), 1, 99)));
  if (effect.op === "buff") box.append(field("Attack", num(effect.attack ?? 0, (v) => put("attack", v), 0, 20)), field("Health", num(effect.health ?? 0, (v) => put("health", v), 0, 20)));
  if (effect.op === "summon") {
    box.append(field("Unit", select(effect.card, game.cards.filter((c) => c.type === "unit").map((c) => [c.id, c.name]), (v) => put("card", v))));
    box.append(field("Count", num(effect.count ?? 1, (v) => put("count", v), 1, 5)));
  }
  if (def?.allows.length) {
    const allowed = def.allows.filter((t) => (ctx.chosen || AUTOMATIC.includes(t)) && (ctx.onUnit || t !== "this"));
    box.append(field("Target", select(effect.target ?? "", [["", "default"], ...allowed.map((t) => [t, t])], (v) => { if (v) effect.target = v; else delete effect.target; changed(); })));
  }
  return box;
}

// ---------------------------------------------------------------- cards
export function cardsTab(game, ui) {
  const { changed, selected, select: pick } = ui;
  const list = h("div", { class: "card-list" });
  const add = h("div", { class: "row" }, TYPES.map((t) => h("button", { type: "button", class: "ghost", text: `+ ${t}`, on: { click: () => { pick(addCard(game, t)); changed(); } } })));
  list.append(add);
  for (const c of game.cards) {
    const lines = describeCard(c, (id) => game.cards.find((x) => x.id === id)?.name ?? id);
    list.append(h("button", { type: "button", class: `card-row${c.id === selected ? " on" : ""}`, on: { click: () => pick(c.id) } },
      h("b", { class: "cost", text: c.cost }), h("span", { class: "name", text: c.name }),
      h("span", { class: "meta", text: `${c.type}${c.type === "unit" ? ` ${c.attack}/${c.health}` : ""} · ${c.element}${lines.length ? ` · ${lines.join(" · ")}` : ""}` })));
  }
  const card = game.cards.find((c) => c.id === selected);
  return h("div", { class: "split" }, list, card ? cardForm(game, card, ui) : h("p", { class: "lede", text: "Pick a card to edit it, or add one." }));
}

function cardForm(game, c, { changed, select: pick }) {
  const put = (k, v) => { c[k] = v; changed(); };
  const form = h("div", { class: "form" });
  form.append(h("div", { class: "row" },
    h("button", { type: "button", class: "ghost", text: "Duplicate", on: { click: () => { pick(duplicateCard(game, c.id)); changed(); } } }),
    h("button", { type: "button", class: "ghost danger", text: "Delete", on: { click: () => { removeCard(game, c.id); pick(null); changed(); } } })));
  form.append(
    field("Name", text(c.name, (v) => put("name", v), { maxlength: 24 })),
    field("Id", text(c.id, (v) => { pick(renameCard(game, c.id, v)); changed(); }), "kebab-case; the deck and summons follow a rename"),
    field("Type", select(c.type, TYPES.map((t) => [t, t]), (t) => {
      c.type = t;
      if (t === "unit") { delete c.effect; c.attack ??= 2; c.health ??= 3; } else { delete c.attack; delete c.health; delete c.keywords; delete c.abilities; c.effect ??= effectDefaults("damage", game); }
      changed();
    })),
    field("Element", select(c.element, game.elements.map((e) => [e.id, e.name]), (v) => put("element", v))),
    field("Cost", num(c.cost, (v) => put("cost", v), 0, 99)),
    field("Rarity", select(c.rarity ?? "common", RARITIES.map((r) => [r, r]), (v) => put("rarity", v))),
    field("Art", text(c.art, (v) => (v ? put("art", v) : (delete c.art, changed())), { placeholder: "./assets/cards/name.webp" }), "a local path under web/; the site serves same-origin images only"),
  );
  if (c.token) form.append(h("p", { class: "hint", text: `NFT: token ${c.token.tokenId} of ${c.token.collection} (chain ${c.token.chainId})` }));
  if (c.type === "unit") {
    form.append(field("Attack", num(c.attack, (v) => put("attack", v), 0, 99)), field("Health", num(c.health, (v) => put("health", v), 1, 99)));
    const kws = h("div", { class: "checks" }, Object.entries(KEYWORDS).map(([k, help]) => h("label", { title: help },
      h("input", { type: "checkbox", checked: c.keywords?.includes(k), on: { change: (e) => { const set = new Set(c.keywords ?? []); e.target.checked ? set.add(k) : set.delete(k); if (set.size) c.keywords = [...set]; else delete c.keywords; changed(); } } }), ` ${k}`)));
    form.append(field("Keywords", kws));
    const abilities = h("div", { class: "abilities" });
    (c.abilities ?? []).forEach((a, i) => {
      abilities.append(h("div", { class: "ability" },
        field("When", select(a.on, Object.entries(TRIGGERS).map(([k, v]) => [k, v]), (v) => { a.on = v; if (v !== "play" && a.effect.target && !AUTOMATIC.includes(a.effect.target)) delete a.effect.target; changed(); })),
        effectEditor(game, a.effect, (e) => { a.effect = e; }, changed, { chosen: a.on === "play", onUnit: a.on !== "death" }),
        h("button", { type: "button", class: "ghost danger", text: "Remove ability", on: { click: () => { c.abilities.splice(i, 1); if (!c.abilities.length) delete c.abilities; changed(); } } })));
    });
    if ((c.abilities?.length ?? 0) < 3) abilities.append(h("button", { type: "button", class: "ghost", text: "+ ability", on: { click: () => { (c.abilities ??= []).push({ on: "play", effect: effectDefaults("damage", game) }); changed(); } } }));
    form.append(field("Abilities", abilities));
  } else {
    form.append(field(c.type === "relic" ? "Each turn" : "Effect", effectEditor(game, c.effect, (e) => { c.effect = e; }, changed, { chosen: c.type === "spell", onUnit: false })));
  }
  return form;
}

// ---------------------------------------------------------------- elements
export function elementsTab(game, { changed }) {
  const box = h("div", { class: "form" });
  for (const el of game.elements) {
    box.append(h("div", { class: "element-row" },
      field("Name", text(el.name, (v) => { el.name = v; changed(); })),
      field("Id", h("input", { type: "text", value: el.id, disabled: true })),
      field("Colour", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(el.color ?? "") ? el.color : "#b8b8b8", on: { change: (e) => { el.color = e.target.value; changed(); } } })),
      field("Beats", h("div", { class: "checks" }, game.elements.filter((o) => o.id !== el.id).map((o) => h("label", {},
        h("input", { type: "checkbox", checked: el.beats?.includes(o.id), on: { change: (e) => { const s = new Set(el.beats ?? []); e.target.checked ? s.add(o.id) : s.delete(o.id); el.beats = [...s]; changed(); } } }), ` ${o.name}`)))),
      h("button", { type: "button", class: "ghost danger", text: "Remove", disabled: game.cards.some((c) => c.element === el.id), title: "Elements in use can't be removed", on: { click: () => { game.elements = game.elements.filter((x) => x !== el); for (const o of game.elements) o.beats = o.beats?.filter((b) => b !== el.id); changed(); } } })));
  }
  box.append(h("button", { type: "button", class: "ghost", text: "+ element", on: { click: () => { const id = uniqueId("element", new Set(game.elements.map((e) => e.id))); game.elements.push({ id, name: "New Element", color: "#9fd8ff", beats: [] }); changed(); } } }));
  return box;
}

// ---------------------------------------------------------------- deck
export function deckTab(game, { changed }) {
  const dr = game.deckRules ?? null;
  const box = h("div", { class: "form" });
  box.append(h("div", { class: "row" },
    field("Decks", select(dr?.mode ?? "fixed", [["fixed", "fixed: everyone plays this deck"], ["declared", "declared: players bring their own"]], (v) => { if (v === "fixed") delete game.deckRules; else game.deckRules = { mode: "declared", size: Math.min(30, deckSize(game)), maxCopies: 2 }; changed(); })),
    dr ? field("Deck size", num(dr.size, (v) => { dr.size = v; changed(); }, 5, 60)) : null,
    dr ? field("Max copies", num(dr.maxCopies, (v) => { dr.maxCopies = v; changed(); }, 1, 10)) : null));
  box.append(h("p", { class: "hint", text: `${deckSize(game)} cards in the ${dr ? "suggested (and fallback) " : ""}deck${dr ? `; it needs at least ${dr.size}` : " (5-120)"}.` }));
  const table = h("div", { class: "deck-table" });
  for (const c of game.cards) {
    const n = game.deck[c.id] ?? 0;
    table.append(h("div", { class: `deck-row${n ? "" : " out"}` },
      h("span", { class: "name", text: `${c.name}` }), h("span", { class: "meta", text: `${c.type} · ${c.cost}` }),
      h("button", { type: "button", class: "ghost", text: "−", "aria-label": `Fewer ${c.name}`, on: { click: () => { setCopies(game, c.id, n - 1); changed(); } } }),
      h("b", { text: n }),
      h("button", { type: "button", class: "ghost", text: "+", "aria-label": `More ${c.name}`, on: { click: () => { setCopies(game, c.id, n + 1); changed(); } } })));
  }
  box.append(table);
  return box;
}

// ---------------------------------------------------------------- rules, champion, powers, LitNode
export function rulesTab(game, { changed }) {
  const box = h("div", { class: "form" });
  box.append(h("h3", { text: "Game" }),
    field("Title", text(game.title, (v) => { game.title = v; changed(); })),
    field("Description", text(game.description, (v) => { game.description = v; changed(); })),
    field("Ruleset id", text(game.litnode.rulesetId, (v) => { game.litnode.rulesetId = v; changed(); }), "name.vN: bump N after any rules or card change once the game is live"),
    field("Max log entries", num(game.litnode.maxTicks, (v) => { game.litnode.maxTicks = v; changed(); }, 20, 5000)));
  box.append(h("h3", { text: "Rules" }));
  const grid = h("div", { class: "grid" });
  for (const [k, label, min, max] of RULE_FIELDS) grid.append(field(label, num(game.rules[k] ?? 0, (v) => { game.rules[k] = v; changed(); }, min, max)));
  grid.append(field("Fatigue", h("input", { type: "checkbox", checked: game.rules.fatigue, on: { change: (e) => { game.rules.fatigue = e.target.checked; changed(); } } })));
  box.append(grid);
  box.append(h("h3", { text: "Champion (ERC-6699 stats → numbers)" }));
  const champ = h("div", { class: "grid" });
  for (const [k, label, lo, hi] of CHAMPION_FIELDS) {
    const m = (game.champion[k] ??= { stat: "resilience", min: lo, max: lo });
    champ.append(h("div", { class: "mapping" }, h("b", { text: label }),
      select(m.stat, STATS.map((s) => [s, s]), (v) => { m.stat = v; changed(); }),
      num(m.min, (v) => { m.min = v; changed(); }, lo, hi), h("span", { text: "to" }), num(m.max, (v) => { m.max = v; changed(); }, lo, hi)));
  }
  box.append(champ);
  box.append(h("h3", { text: "Hero powers" }), h("p", { class: "hint", text: "Each champion gets the first power whose conditions match; a power with no condition is the default." }));
  const powers = (game.champion.powers ??= []);
  powers.forEach((p, i) => {
    box.append(h("div", { class: "power" },
      h("div", { class: "row" },
        field("Name", text(p.name, (v) => { p.name = v; changed(); })),
        field("Cost", num(p.cost, (v) => { p.cost = v; changed(); }, 0, 10)),
        field("Element", select(p.element ?? "", [["", "any"], ...game.elements.map((e) => [e.id, e.name])], (v) => { if (v) p.element = v; else delete p.element; changed(); })),
        field("Highest stat", select(p.stat ?? "", [["", "any"], ...STATS.map((s) => [s, s])], (v) => { if (v) p.stat = v; else delete p.stat; changed(); }))),
      effectEditor(game, p.effect, (e) => { p.effect = e; }, changed, { chosen: true, onUnit: false }),
      h("button", { type: "button", class: "ghost danger", text: "Remove power", on: { click: () => { powers.splice(i, 1); changed(); } } })));
  });
  box.append(h("button", { type: "button", class: "ghost", text: "+ hero power", on: { click: () => { powers.push({ id: uniqueId("power", new Set(powers.map((p) => p.id))), name: "New Power", cost: 2, effect: effectDefaults("damage", game) }); changed(); } } }));
  return box;
}
