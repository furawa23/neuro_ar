import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHitTarget } from '../src/ar/hit-target.js';

const camera = { x: 0, y: 1.5, z: 0 };
const point = position => ({ type: 'FEATURE_POINT', position });

test('a real feature-point position supplies geometric distance and an upright model heading', () => {
  for (const position of [{ x: 0.5, y: 0.75, z: -1 }, [0.5, 0.75, -1], new Float32Array([0.5, 0.75, -1])]) {
    const { target, rejection } = normalizeHitTarget(point(position), camera);
    assert.equal(rejection, null);
    assert.deepEqual(target.position, { x: 0.5, y: 0.75, z: -1 });
    assert.equal(target.distance, Math.hypot(0.5, 0.75, 1));
    assert.equal(target.rotation.x, 0);
    assert.equal(target.rotation.z, 0);
    const yaw = 2 * Math.atan2(target.rotation.y, target.rotation.w);
    assert.ok(Math.abs(yaw - Math.atan2(-0.5, 1)) < 1e-12);
    const { target: withUnusableMetadata } = normalizeHitTarget({ ...point(position),
      distance: Infinity, rotation: { x: NaN, y: 0, z: 0, w: 0 } }, camera);
    assert.deepEqual(withUnusableMetadata, target);
  }
});

test('missing, nonfinite or implausible coordinates cannot invent a world point', () => {
  for (const position of [undefined, null, {}, [1, 2], { x: '0', y: 0, z: -1 },
    { x: 0, y: NaN, z: -1 }, new Float32Array([0, 0, Infinity])]) {
    assert.equal(normalizeHitTarget(point(position), camera).rejection, 'position');
  }
  for (const position of [camera, { x: 0, y: 1.5, z: -20 }]) {
    assert.equal(normalizeHitTarget(point(position), camera).rejection, 'distance');
  }
  assert.equal(normalizeHitTarget(point([0, 0, -1]), null).rejection, 'position');
  assert.equal(normalizeHitTarget({ type: 'UNSPECIFIED', position: [0, 0, -1] }, camera).rejection, 'type');
});

test('surface results retain a measured orientation while a vertical point has a deterministic heading', () => {
  const surface = { type: 'ESTIMATED_SURFACE', position: [0, 0, -1], rotation: [0, 0, 0, 2] };
  assert.deepEqual(normalizeHitTarget(surface, camera).target.rotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(normalizeHitTarget({ ...surface, rotation: [0, 0, 0, 0] }, camera).rejection, 'rotation');
  assert.equal(normalizeHitTarget({ ...surface, rotation: undefined }, camera).rejection, 'rotation');
  assert.deepEqual(normalizeHitTarget(point([0, 0, 0]), camera).target.rotation, { x: 0, y: 0, z: 0, w: 1 });
});
