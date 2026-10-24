import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { simulate, validateGame } from "../web/engine/tessaract.js";
import { addCard, deckSize, duplicateCard, effectDefaults, parseGame, removeCard, renameCard, setCopies, toJson } from "../web/model.js";

const starter = () => JSON.parse(readFileSync(new URL("../web/data/starter.game.json", import.meta.url), "utf8"));

test("adding, duplicating and removing cards keeps the game valid", () => {
  const g = starter();
  for (const t of ["unit", "spell", "relic"]) addCard(g, t);
  const dup = duplicateCard(g, g.cards[0].id);
  assert.ok(dup && g.cards.some((c) => c.id === dup));
  assert.deepEqual(validateGame(g), []);
  removeCard(g, dup);
  assert.ok(!g.cards.some((c) => c.id === dup) && !(dup in g.deck));
  assert.deepEqual(validateGame(g), []);
});

test("renaming a card follows it into the deck and into summons", () => {
  const g = starter();
  const unit = g.cards.find((c) => c.type === "unit");
  const spell = g.cards.find((c) => c.type === "spell");
  spell.effect = { ...effectDefaults("summon", g), card: unit.id };
  const order = Object.keys(g.deck), oldId = unit.id;
  const id = renameCard(g, oldId, "Brand New Name");
  assert.equal(id, "brand-new-name");
  assert.equal(spell.effect.card, id);
  assert.ok(id in g.deck && !(oldId in g.deck));
  assert.equal(Object.keys(g.deck).indexOf(id), order.indexOf(oldId), "deck order kept");
  assert.equal(renameCard(g, id, g.cards[1].id), id, "a taken id is refused");
  assert.deepEqual(validateGame(g), []);
});

test("every effect op has defaults that validate", () => {
  const g = starter();
  for (const op of ["damage", "heal", "draw", "energy", "buff", "shield", "summon"]) {
    const spell = g.cards.find((c) => c.type === "spell");
    spell.effect = effectDefaults(op, g);
    assert.deepEqual(validateGame(g), [], op);
  }
});

test("deck counts, export round trip, and the shared balance harness", () => {
  const g = starter();
  const before = deckSize(g);
  setCopies(g, g.cards[0].id, (g.deck[g.cards[0].id] ?? 0) + 1);
  assert.equal(deckSize(g), before + 1);
  assert.deepEqual(parseGame(toJson(g)), g);
  assert.throws(() => parseGame('{"title":"x"}'), /not a Tessaract game config/);
  const r = simulate(g, { matches: 20 });
  assert.equal(r.matches, 20);
  assert.equal(r.mismatches, 0);
  assert.equal(r.targets.length, 7);
});
