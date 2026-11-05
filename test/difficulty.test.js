import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_LENGTHS } from '../public/game.js';
import { DIFFICULTIES, difficultyRules, difficultyPoints } from '../public/difficulty.js';

test('difficulty clips use only the requested intervals and regular retains all seven', () => {
  assert.deepEqual(difficultyRules('regular').clips, CLIP_LENGTHS);
  assert.deepEqual(difficultyRules('easy').clips, [1, 3, 5, 10, 15]);
  assert.deepEqual(difficultyRules('hard').clips, [0.1, 0.5, 1, 3, 5]);
  for (const rules of Object.values(DIFFICULTIES)) assert.ok(rules.clips.every(clip => CLIP_LENGTHS.includes(clip)));
  assert.equal(difficultyRules('unknown'), DIFFICULTIES.regular);
});
test('points reflect audio unlocked, with hints available only on easy and regular', () => {
  assert.equal(difficultyPoints('easy', 0), 800);
  assert.equal(difficultyPoints('easy', 0, true), 650);
  assert.equal(difficultyPoints('easy', 4, true), 50);
  assert.equal(difficultyPoints('regular', 0), 1000);
  assert.equal(difficultyPoints('regular', 6), 100);
  assert.equal(difficultyRules('hard').hints, false);
  assert.equal(difficultyPoints('hard', 0, true), 1000);
  assert.equal(difficultyPoints('hard', 4), 400);
});
