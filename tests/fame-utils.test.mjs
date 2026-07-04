import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateFameTarget,
  isFameSuccess,
  normalizeFame
} from "../scripts/fame-utils.mjs";

test("normalizeFame defaults invalid values to zero", () => {
  assert.equal(normalizeFame(undefined), 0);
  assert.equal(normalizeFame("not-a-number"), 0);
});

test("normalizeFame truncates and clamps persisted values", () => {
  assert.equal(normalizeFame(25.9), 25);
  assert.equal(normalizeFame(-4), 0);
  assert.equal(normalizeFame(130), 100);
});

test("calculateFameTarget averages, rounds down, and clamps", () => {
  assert.equal(calculateFameTarget(13, 20), 16);
  assert.equal(calculateFameTarget(14, 20), 17);
  assert.equal(calculateFameTarget(-30, 10), 0);
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
