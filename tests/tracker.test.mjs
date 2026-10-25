import test from "node:test";
import assert from "node:assert/strict";
import { DrowsinessTracker, eyeAspectRatio, DEFAULTS } from "../src/detection.js";

const cfg = { ...DEFAULTS, smoothing: 0 };
const openEye = [{x:0,y:0},{x:1,y:-1},{x:2,y:-1},{x:3,y:0},{x:2,y:1},{x:1,y:1}];

test("EAR of a known shape", () => {
  assert.ok(Math.abs(eyeAspectRatio(openEye) - 2 / 3) < 1e-9);
});

test("short blink does not warn", () => {
  const t = new DrowsinessTracker();
  t.update(0.3, 0, cfg);
  assert.equal(t.update(0.1, 100, cfg).warning, false);
  assert.equal(t.update(0.1, 600, cfg).warning, false);
  assert.equal(t.update(0.3, 700, cfg).closedMs, 0);
});

test("sustained closure warns once, clears after reopen", () => {
  const t = new DrowsinessTracker();
  t.update(0.1, 0, cfg);
  const r = t.update(0.1, 1600, cfg);
  assert.ok(r.warning && r.newWarning);
  assert.equal(t.update(0.1, 1700, cfg).newWarning, false);
  assert.equal(t.update(0.3, 1800, cfg).warning, true);   // hysteresis
  assert.equal(t.update(0.3, 2300, cfg).warning, false);
});

test("missing face never counts as closed and resets state", () => {
  const t = new DrowsinessTracker();
  t.update(0.1, 0, cfg);
  const r = t.update(null, 2000, cfg);
  assert.deepEqual([r.closed, r.warning, r.closedMs], [false, false, 0]);
  assert.equal(t.update(0.1, 2100, cfg).closedMs, 0);
});
