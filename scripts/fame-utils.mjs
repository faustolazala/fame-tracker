export const MIN_FAME = 0;
export const MAX_FAME = Number.POSITIVE_INFINITY;
export const MAX_PERCENTILE = 100;

export const FAME_RANKS = Object.freeze([
  { id: "legend", minimum: 151, bonus: 5 },
  { id: "revered", minimum: 91, bonus: 4 },
  { id: "honored", minimum: 71, bonus: 3 },
  { id: "admired", minimum: 41, bonus: 2 },
  { id: "known", minimum: 26, bonus: 1 },
  { id: "unknown", minimum: 0, bonus: 0 }
]);

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeFame(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_FAME;
  return clamp(Math.trunc(number), MIN_FAME, MAX_FAME);
}

export function getFameRank(fame) {
  const normalizedFame = normalizeFame(fame);
  return FAME_RANKS.find(rank => normalizedFame >= rank.minimum) ?? FAME_RANKS.at(-1);
}

export function calculateFameTarget(performanceTotal, fame) {
  const performance = Number(performanceTotal);
  const normalizedPerformance = Number.isFinite(performance) ? performance : 0;
  return clamp(
    Math.floor((normalizedPerformance + normalizeFame(fame)) / 2),
    MIN_FAME,
    MAX_PERCENTILE
  );
}

export function isFameSuccess(percentileTotal, target) {
  const result = Number(percentileTotal);
  return Number.isFinite(result) && result >= 1 && result <= clamp(Math.floor(target), MIN_FAME, MAX_PERCENTILE);
}