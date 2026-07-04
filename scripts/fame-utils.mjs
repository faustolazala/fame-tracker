export const MIN_FAME = 0;
export const MAX_FAME = 100;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeFame(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_FAME;
  return clamp(Math.trunc(number), MIN_FAME, MAX_FAME);
}

export function calculateFameTarget(performanceTotal, fame) {
  const performance = Number(performanceTotal);
  const normalizedPerformance = Number.isFinite(performance) ? performance : 0;
  return clamp(
    Math.floor((normalizedPerformance + normalizeFame(fame)) / 2),
    MIN_FAME,
    MAX_FAME
  );
}

export function isFameSuccess(percentileTotal, target) {
  const result = Number(percentileTotal);
  return Number.isFinite(result) && result >= 1 && result <= clamp(Math.floor(target), 0, 100);
}
