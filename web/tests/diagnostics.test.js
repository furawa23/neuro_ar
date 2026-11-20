import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostics } from '../src/ar/diagnostics-view.js';

test('diagnostics distinguish initialization from active tracking without a placement target', () => {
  const initial = formatDiagnostics({ state: 'initializing', video: 'live', engineTrackingStatus: 'LIMITED', engineTrackingReason: 'INITIALIZING', rejection: 'tracking-limited' });
  const searching = formatDiagnostics({ state: 'no-target', video: 'live', engineTrackingStatus: 'NORMAL', engineTrackingReason: 'UNSPECIFIED', rejection: 'no-hits', lastPoseAgeMs: 12 });
  assert.equal(initial.camera, 'Activa');
  assert.equal(initial.movement, 'Inicializando');
  assert.equal(searching.camera, 'Activa');
  assert.equal(searching.movement, 'Activo según el motor');
  assert.notEqual(initial.reason, searching.reason);
  assert.match(searching.target, /Sin puntos/);
});

test('camera freshness and invalid pose data are reported independently from SDK NORMAL', () => {
  const stale = formatDiagnostics({ state: 'limited', video: 'stalled', engineTrackingStatus: 'NORMAL', rejection: 'stale-video' });
  assert.equal(stale.camera, 'Sin imágenes recientes');
  assert.equal(stale.movement, 'Esperando imagen reciente');
  const badProjection = formatDiagnostics({ state: 'limited', video: 'live', engineTrackingStatus: 'NORMAL', rejection: 'invalid-projection' });
  assert.equal(badProjection.camera, 'Activa');
  assert.equal(badProjection.movement, 'Datos no válidos');
  assert.match(badProjection.reason, /proyección/);
});

test('counts and pose age reject nonfinite, negative, fractional and nonnumeric inputs safely', () => {
  const output = formatDiagnostics({
    state: 'target', video: 'live', engineTrackingStatus: 'NORMAL', validTargets: Infinity,
    hitCounts: { FEATURE_POINT: NaN, ESTIMATED_SURFACE: -3, DETECTED_SURFACE: '4' },
    lastPoseAgeMs: NaN,
  });
  assert.match(output.target, /Sin puntos válidos/);
  assert.match(output.copyText, /puntos_3d: 0\nsuperficies_estimadas: 0\nsuperficies_detectadas: 0/);
  assert.match(output.copyText, /objetivos_validos: 0\nedad_pose_ms: sin dato$/);
  assert.doesNotMatch(output.copyText, /NaN|Infinity/);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined]) {
    assert.match(formatDiagnostics({ validTargets: value }).copyText, /objetivos_validos: 0/);
  }
  assert.match(formatDiagnostics({ lastPoseAgeMs: 12.9 }).copyText, /edad_pose_ms: 12$/);
});

test('diagnostic copy is deterministic, versioned and excludes arbitrary scene or user data', () => {
  const packet = {
    state: 'target', video: 'live', engineTrackingStatus: 'NORMAL', engineTrackingReason: 'UNSPECIFIED',
    rejection: null, validTargets: 2, hitCounts: { FEATURE_POINT: 6, ESTIMATED_SURFACE: 1, DETECTED_SURFACE: 0 }, lastPoseAgeMs: 8,
    position: { x: 8.18, y: 9.19, z: 10.2 }, rotation: { w: 1 }, images: ['private-image-data'],
    reason: 'https://example.invalid/private-user?token=secret', url: 'private-url', user: 'private-user',
  };
  const output = formatDiagnostics(packet);
  assert.equal(output.copyText, formatDiagnostics({ ...packet }).copyText);
  assert.match(output.copyText, /^NeuroAR · diagnóstico local\nrevision: puntos3d-1\n/);
  assert.match(output.copyText, /puntos_3d: 6/);
  assert.equal(output.target, '2 puntos válidos');
  assert.doesNotMatch(output.copyText, /private|secret|https|8\.18|9\.19|rotation|images|position/);
  const hostile = formatDiagnostics({ state: packet.reason, video: packet.reason, engineTrackingStatus: packet.reason, engineTrackingReason: packet.reason, rejection: packet.reason, hitCounts: { [packet.reason]: 25 } });
  assert.doesNotMatch(hostile.copyText, /private|secret|https/);
  assert.match(hostile.copyText, /estado: unknown/);
});

test('missing packets and incomplete states have safe text without claiming physical tracking', () => {
  for (const packet of [undefined, null, [], 'untrusted', {}, { hitCounts: null }]) {
    const output = formatDiagnostics(packet);
    for (const field of ['camera', 'movement', 'target', 'reason', 'copyText']) {
      assert.equal(typeof output[field], 'string');
      assert.ok(output[field].length > 0);
      assert.doesNotMatch(output[field], /NaN|undefined/);
    }
    assert.equal(output.camera, 'Sin datos');
    assert.equal(output.movement, 'Esperando seguimiento');
  }
  const placed = formatDiagnostics({ state: 'placed', video: 'live', engineTrackingStatus: 'NORMAL' });
  assert.equal(placed.target, 'Red colocada según el motor');
  assert.match(placed.reason, /verifica su estabilidad/);
});
