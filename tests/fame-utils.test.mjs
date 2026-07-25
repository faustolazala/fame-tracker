import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateFameTarget,
  getFameRank,
  isFameSuccess,
  normalizeFame
} from "../scripts/fame-utils.mjs";

test("normalizeFame defaults invalid values to zero", () => {
  assert.equal(normalizeFame(undefined), 0);
  assert.equal(normalizeFame("not-a-number"), 0);
});

test("normalizeFame truncates, floors at zero, and supports Legend fame", () => {
  assert.equal(normalizeFame(25.9), 25);
  assert.equal(normalizeFame(-4), 0);
  assert.equal(normalizeFame(130), 130);
  assert.equal(normalizeFame(151), 151);
});

test("getFameRank selects every rank at its threshold", () => {
  const cases = [
    [0, "unknown", 0, 0], [25, "unknown", 0, 0], [26, "known", 1, 26], [40, "known", 1, 26],
    [41, "admired", 2, 41], [70, "admired", 2, 41], [71, "honored", 3, 71], [90, "honored", 3, 71],
    [91, "revered", 4, 91], [150, "revered", 4, 91], [151, "legend", 5, 151], [999, "legend", 5, 151]
  ];

  for (const [fame, id, bonus, minimum] of cases) {
    assert.deepEqual(getFameRank(fame), { id, minimum, bonus });
  }
});

test("calculateFameTarget averages, rounds down, and remains a percentile target", () => {
  assert.equal(calculateFameTarget(13, 20), 16);
  assert.equal(calculateFameTarget(14, 20), 17);
  assert.equal(calculateFameTarget(-30, 10), 0);
  assert.equal(calculateFameTarget(10, 151), 80);
  assert.equal(calculateFameTarget(150, 100), 100);
});

test("isFameSuccess accepts one and exact target", () => {
  assert.equal(isFameSuccess(1, 40), true);
  assert.equal(isFameSuccess(40, 40), true);
});

test("isFameSuccess rejects values outside the passing interval", () => {
  assert.equal(isFameSuccess(41, 40), false);
  assert.equal(isFameSuccess(0, 40), false);
  assert.equal(isFameSuccess(1, 0), false);
});