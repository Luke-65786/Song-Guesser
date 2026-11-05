import { CLIP_LENGTHS, pointsFor } from './game.js';

export const DIFFICULTIES = Object.freeze({
  easy: { label: 'Easy', clips: Object.freeze([1, 3, 5, 10, 15]), hints: true, description: 'Start at 1 second · 5 chances · hints available · up to 800 points.' },
  regular: { label: 'Regular', clips: CLIP_LENGTHS, hints: true, description: 'Start at 0.1 seconds · 7 chances · hints available · up to 1,000 points.' },
  hard: { label: 'Hard', clips: Object.freeze([0.1, 0.5, 1, 3, 5]), hints: false, description: 'Start at 0.1 seconds · 5 chances · 5-second maximum · no hints.' },
});
export function difficultyRules(key) { return DIFFICULTIES[key] || DIFFICULTIES.regular; }
export function difficultyPoints(key, attempt, hinted = false) {
  const rules = difficultyRules(key);
  const duration = rules.clips[Math.min(rules.clips.length - 1, Math.max(0, attempt))];
  return pointsFor(CLIP_LENGTHS.indexOf(duration), hinted && rules.hints);
}
