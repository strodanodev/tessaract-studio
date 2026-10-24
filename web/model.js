// Tessaract Studio's model: pure edits on a game config (the same JSON `tessaract` reads). No DOM here, so the
// edits are testable in node. Validation itself is the SDK's validateGame, run by the app after every change.

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
export const TYPES = ["unit", "spell", "relic"];
export const STATS = ["strength", "agility", "resilience", "intelligence"];
export const RULE_FIELDS = [
  ["boardSlots", "Board slots", 1, 5], ["relicSlots", "Relic slots", 0, 5], ["handLimit", "Hand limit", 1, 16],
  ["energyStart", "Energy at start", 0, 99], ["energyMax", "Energy cap", 1, 99], ["energyPerTurn", "Energy per turn", 0, 99],
  ["elementBonus", "Element bonus", 0, 99], ["secondPlayerEnergy", "2nd player energy", 0, 99], ["secondPlayerCards", "2nd player cards", 0, 5],
];
export const CHAMPION_FIELDS = [["life", "Life", 1, 999], ["spellPower", "Spell power", 0, 20], ["unitAttack", "Unit attack", 0, 20], ["openingHand", "Opening hand", 0, 10]];

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";

/** An id not yet used by a card (or element, with `pool`). */
export function uniqueId(base, used) {
  const b = slug(base);
  if (!used.has(b)) return b;
  for (let i = 2; ; i++) if (!used.has(`${b}-${i}`)) return `${b}-${i}`;
}

const firstElement = (game) => (game.elements.find((e) => e.id !== "neutral") ?? game.elements[0])?.id ?? "neutral";

/** Default fields for an effect op, so switching ops in the editor always yields a valid shape. */
export function effectDefaults(op, game) {
  switch (op) {
    case "damage": case "heal": return { op, amount: 2 };
    case "draw": case "energy": return { op, amount: 1 };
    case "buff": return { op, attack: 1, health: 1 };
    case "shield": return { op };
    case "summon": return { op, card: game.cards.find((c) => c.type === "unit")?.id ?? "" };
    default: return { op: "damage", amount: 2 };
  }
}

export function blankCard(game, type = "unit") {
  const used = new Set(game.cards.map((c) => c.id));
  const id = uniqueId(`new-${type}`, used);
  const base = { id, name: `New ${type[0].toUpperCase()}${type.slice(1)}`, type, element: firstElement(game), cost: 2, rarity: "common" };
  if (type === "unit") return { ...base, attack: 2, health: 3 };
  return { ...base, effect: type === "relic" ? { op: "damage", amount: 1 } : { op: "damage", amount: 3 } };
}

/** Add a card (and one copy to the deck); returns its id. */
export function addCard(game, type) {
  const card = blankCard(game, type);
  game.cards.push(card);
  game.deck[card.id] = 1;
  return card.id;
}

export function duplicateCard(game, id) {
  const src = game.cards.find((c) => c.id === id);
  if (!src) return null;
  const copy = structuredClone(src);
  delete copy.token;   // a copy is a new design, not the NFT
  copy.id = uniqueId(`${src.id}-copy`, new Set(game.cards.map((c) => c.id)));
  copy.name = `${src.name} (copy)`;
  game.cards.splice(game.cards.indexOf(src) + 1, 0, copy);
  return copy.id;
}

/** Remove a card and its deck entry. Summons that named it stay, and validation points at them. */
export function removeCard(game, id) {
  game.cards = game.cards.filter((c) => c.id !== id);
  delete game.deck[id];
}

/** Every effect in the game: card effects, abilities and hero powers. */
export function* effects(game) {
  for (const c of game.cards) {
    if (c.effect) yield c.effect;
    for (const a of c.abilities ?? []) yield a.effect;
  }
  for (const p of game.champion?.powers ?? []) yield p.effect;
}

/** Change a card id everywhere it is referenced: the deck and summon effects. */
export function renameCard(game, oldId, wanted) {
  const id = slug(wanted);
  if (!id || id === oldId || game.cards.some((c) => c.id === id)) return oldId;
  const card = game.cards.find((c) => c.id === oldId);
  if (!card) return oldId;
  card.id = id;
  if (oldId in game.deck) {
    // Keep deck order stable: rebuild the object with the key renamed in place.
    game.deck = Object.fromEntries(Object.entries(game.deck).map(([k, v]) => [k === oldId ? id : k, v]));
  }
  for (const e of effects(game)) if (e.op === "summon" && e.card === oldId) e.card = id;
  return id;
}

export const deckSize = (game) => Object.values(game.deck).reduce((n, v) => n + (Number.isInteger(v) ? v : 0), 0);

export function setCopies(game, id, n) {
  if (n <= 0) delete game.deck[id];
  else game.deck[id] = Math.min(60, Math.round(n));
}

/** The game as the file `tessaract` reads. */
export const toJson = (game) => `${JSON.stringify(game, null, 2)}\n`;

/** A parsed file that at least looks like a game config; validateGame says the rest. */
export function parseGame(text) {
  if (text.length > 2_000_000) throw new Error("file too large for a game config");
  const g = JSON.parse(text);
  if (!g || typeof g !== "object" || !Array.isArray(g.cards) || !Array.isArray(g.elements) || typeof g.deck !== "object") throw new Error("not a Tessaract game config (needs cards, elements and deck)");
  g.champion ??= {};
  g.rules ??= {};
  g.litnode ??= {};
  return g;
}
