import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Group, PerspectiveCamera } from 'three';
import { WorldTracker } from '../src/ar/world-tracker.js';

// These tests exercise our adapter against documented SDK callbacks. They do
// not simulate or certify physical SLAM, camera accuracy, or phone support.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name) { for (const callback of this.listeners.get(name) ?? []) callback(); }
}

function stream() {
  const track = new Events();
  track.stopped = 0;
  track.stop = () => track.stopped++;
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function createFixture({ loadEngine, failCamera = false } = {}) {
  let now = 1000;
  const document = new Events();
  document.hidden = false;
  document.createElement = () => ({ width: 300, height: 150, style: {}, setAttribute() {},
    remove() { this.removed = true; } });
  const window = new Events();
  window.devicePixelRatio = 3;
  const observers = [];
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const stage = { width: 640, height: 480, canvases: [],
    prepend(canvas) { this.canvases.push(canvas); },
    getBoundingClientRect() { return { width: this.width, height: this.height }; } };
  const renderer = { domElement: { parentElement: stage } };
  const camera = new Camera();
  const anchor = new Group();
  const callbacks = { status: [], tracking: [], placement: [], reticle: [], stop: [], render: [], diagnostics: [] };
  const sourceStream = stream();
  const video = { readyState: 2, currentTime: 0 };
  const history = [];
  const engine = {
    modules: [], runs: [], stops: 0, recenters: 0, chunks: [], config: [], projections: [], hits: [], hitCalls: [],
    loadChunk(name) { this.chunks.push(name); return Promise.resolve(); },
    clearCameraPipelineModules() { this.modules = []; },
    addCameraPipelineModules(modules) { this.modules = modules; history.push(modules.at(-1)); },
    stop() { this.stops++; },
    GlTextureRenderer: { pipelineModule: () => ({ name: 'camera-feed' }) },
    XrDevice: { isDeviceBrowserCompatible: () => true },
    XrConfig: { camera: () => ({ BACK: 'back' }), device: () => ({ MOBILE: 'mobile' }) },
    run(options) {
      this.runs.push(options);
      const module = this.modules.at(-1);
      if (failCamera) { module.onCameraStatusChange({ status: 'failed' }); return; }
      module.onCameraStatusChange({ status: 'hasStream', stream: sourceStream });
      module.onCameraStatusChange({ status: 'hasVideo', video });
      module.onStart({ canvasWidth: options.canvas.width, canvasHeight: options.canvas.height });
    },
  };
  engine.XrController = {
    configure: config => engine.config.push(config),
    pipelineModule: () => ({ name: 'reality' }),
    updateCameraProjectionMatrix: parameters => engine.projections.push(parameters),
    hitTest: (x, y, includedTypes) => {
      engine.hitCalls.push([x, y, includedTypes]);
      return typeof engine.hits === 'function' ? engine.hits(x, y, includedTypes) : engine.hits;
    },
    recenter: () => engine.recenters++,
  };
  const tracker = new WorldTracker({ renderer, camera, anchor,
    platform: { document, window, isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } },
    engineLoader: loadEngine ?? (() => Promise.resolve(engine)), clock: () => now,
    onStatus: value => callbacks.status.push(value), onTracking: value => callbacks.tracking.push(value),
    onPlacement: value => callbacks.placement.push(value), onReticle: value => callbacks.reticle.push(value),
    onStop: value => callbacks.stop.push(value),
    onDiagnostics: value => callbacks.diagnostics.push(value),
    onRender: milliseconds => callbacks.render.push({ milliseconds, position: camera.position.toArray(),
      projection: [...camera.projectionMatrix.elements] }),
  });
  const intrinsics = [...new PerspectiveCamera(52, 4 / 3, 0.01, 30).projectionMatrix.elements];
  const reality = (overrides = {}) => ({ position: { x: 0, y: 1.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, intrinsics,
    trackingStatus: 'NORMAL', trackingReason: 'UNSPECIFIED', ...overrides });
  const emit = (overrides = {}, { newVideoFrame = true } = {}) => {
    if (newVideoFrame) video.currentTime += 1 / 30;
    history.at(-1).onUpdate({ processCpuResult: { reality: reality(overrides) } });
  };
  return { tracker, engine, history, stage, camera, anchor, callbacks, sourceStream, video, observers,
    document, window, reality, emit, setTime: value => { now = value; } };
}

const surface = overrides => ({ type: 'DETECTED_SURFACE', distance: 1.3,
  position: { x: 0.2, y: 0.1, z: -1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, ...overrides });

test('world adapter starts the real-world pipeline and copies 6DoF camera/projection data', async () => {
  const fixture = createFixture();
  try {
    assert.equal(await fixture.tracker.start(), true);
    assert.deepEqual(fixture.engine.chunks, ['slam']);
    assert.deepEqual(fixture.engine.config, [{ disableWorldTracking: false, enableLighting: false,
      enableWorldPoints: false, scale: 'responsive' }]);
    assert.equal(fixture.engine.runs[0].allowedDevices, 'mobile');
    assert.equal(fixture.engine.runs[0].cameraConfig.direction, 'back');
    assert.equal(fixture.engine.modules.length, 3);
    assert.equal(fixture.engine.runs[0].canvas.width, 960);
    assert.equal(fixture.engine.runs[0].canvas.height, 720);
    fixture.emit({ position: { x: 1.2, y: 1.1, z: -0.8 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } });
    assert.deepEqual(fixture.camera.position.toArray(), [1.2, 1.1, -0.8]);
    assert.ok(Math.abs(fixture.camera.quaternion.y - Math.SQRT1_2) < 1e-12);
    assert.deepEqual(fixture.camera.projectionMatrix.elements, fixture.reality().intrinsics);
    assert.equal(fixture.tracker.tracking, true);
    assert.equal(fixture.tracker.placed, false);
    assert.equal(fixture.anchor.visible, false);
  } finally { fixture.tracker.dispose(); }
});

test('SDK surface placement stays fixed while the camera moves', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.engine.hits = [surface()];
    fixture.emit();
    assert.deepEqual(fixture.callbacks.reticle.at(-1).position, surface().position);
    assert.equal(fixture.tracker.placeAt(0.3, 0.7), true);
    const fixedPosition = fixture.anchor.position.toArray();
    const fixedQuaternion = fixture.anchor.quaternion.toArray();
    const calls = fixture.engine.hitCalls.length;
    fixture.emit({ position: { x: 0.8, y: 1.2, z: -0.4 } });
    fixture.emit({ position: { x: -0.5, y: 1.1, z: -0.2 } });
    assert.deepEqual(fixture.anchor.position.toArray(), fixedPosition);
    assert.deepEqual(fixture.anchor.quaternion.toArray(), fixedQuaternion);
    assert.equal(fixture.engine.hitCalls.length, calls, 'a placed anchor is not re-hit-tested each frame');
    assert.deepEqual(fixture.camera.position.toArray(), [-0.5, 1.1, -0.2]);
    assert.equal(fixture.tracker.placeAt(0.1, 0.1), false);
    assert.deepEqual(fixture.callbacks.placement, [true]);
    fixture.tracker.reposition();
    assert.equal(fixture.tracker.placed, false);
    assert.equal(fixture.anchor.visible, false);
    assert.deepEqual(fixture.camera.position.toArray(), [-0.5, 1.1, -0.2]);
    fixture.engine.hits = [surface({ position: { x: 1, y: 0, z: -2 } })];
    fixture.emit();
    assert.equal(fixture.tracker.placeAt(), true);
    assert.deepEqual(fixture.anchor.position.toArray(), [1, 0, -2]);
  } finally { fixture.tracker.dispose(); }
});

test('unknown targets, invalid hits and untracked states cannot place', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.engine.hits = [surface()];
    assert.equal(fixture.tracker.placeAt(), false, 'no pose has been received yet');
    fixture.emit();
    for (const hits of [[], [surface({ type: 'UNSPECIFIED' })],
      [surface({ position: { x: NaN, y: 0, z: -1 } })], [surface({ rotation: { x: 0, y: 0, z: 0, w: 0 } })],
      [surface({ position: { x: 0, y: 1.5, z: 0 } })],
      [surface({ position: { x: 0, y: 1.5, z: -20 } })]]) {
      fixture.engine.hits = hits;
      assert.equal(fixture.tracker.placeAt(0.5, 0.5), false);
      assert.equal(fixture.anchor.visible, false);
    }
    fixture.engine.hits = [surface({ type: 'ESTIMATED_SURFACE' })];
    for (const coordinates of [[NaN, 0.5], [-0.1, 0.5], [1.1, 0.5], [0.5, -1]]) {
      assert.equal(fixture.tracker.placeAt(...coordinates), false);
    }
    fixture.emit({ trackingStatus: 'LIMITED' });
    assert.equal(fixture.tracker.placeAt(), false);
    fixture.emit();
    assert.equal(fixture.tracker.placeAt(), true, 'an actual SDK estimated-surface hit is accepted');
  } finally { fixture.tracker.dispose(); }
});

test('limited, invalid and stale poses hide an existing anchor without relocating it', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start(); fixture.engine.hits = [surface()]; fixture.emit(); fixture.tracker.placeAt();
    const fixedPosition = fixture.anchor.position.toArray();
    fixture.emit({ trackingStatus: 'LIMITED', position: { x: 100, y: 100, z: 100 } });
    assert.equal(fixture.anchor.visible, false);
    assert.equal(fixture.tracker.placed, true);
    assert.equal(fixture.tracker.tracking, false);
    fixture.emit({ intrinsics: Array(16).fill(0) });
    assert.equal(fixture.tracker.tracking, false);
    fixture.emit({ rotation: { x: 0, y: 0, z: 0, w: NaN } });
    assert.equal(fixture.tracker.tracking, false);
    fixture.emit();
    assert.equal(fixture.anchor.visible, true);
    fixture.setTime(1400); fixture.tracker.update();
    assert.equal(fixture.anchor.visible, false);
    assert.equal(fixture.tracker.tracking, false);
    assert.deepEqual(fixture.anchor.position.toArray(), fixedPosition);
    fixture.emit();
    assert.equal(fixture.anchor.visible, true);
    assert.deepEqual(fixture.anchor.position.toArray(), fixedPosition);
  } finally { fixture.tracker.dispose(); }
});

test('a frozen video cannot refresh pose freshness merely by repeating SDK updates', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start(); fixture.engine.hits = [surface()]; fixture.emit(); fixture.tracker.placeAt();
    fixture.setTime(1400); fixture.emit({}, { newVideoFrame: false });
    assert.equal(fixture.anchor.visible, false);
    assert.equal(fixture.tracker.tracking, false);
    fixture.setTime(6100); fixture.tracker.update();
    assert.equal(fixture.tracker.active, false);
    assert.equal(fixture.callbacks.stop.length, 1);
    assert.equal(fixture.sourceStream.track.stopped > 0, true);
  } finally { fixture.tracker.dispose(); }
});

test('live camera frames survive prolonged LIMITED initialization and missing SDK results', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    for (let second = 1; second <= 8; second++) {
      fixture.setTime(1000 + second * 1000);
      fixture.emit({ trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' });
      fixture.tracker.update();
      assert.equal(fixture.tracker.active, true, `live initialization must not time out at ${second}s`);
      assert.equal(fixture.tracker.tracking, false);
      assert.equal(fixture.anchor.visible, false);
    }
    for (let second = 9; second <= 16; second++) {
      fixture.setTime(1000 + second * 1000);
      fixture.video.currentTime += 1 / 30;
      // No onUpdate/reality callback: the camera is still producing frames.
      fixture.tracker.update();
      assert.equal(fixture.tracker.active, true, `video without an SDK result remains live at ${second}s`);
      assert.equal(fixture.tracker.tracking, false);
    }
    assert.equal(fixture.callbacks.stop.length, 0);
    // Now the camera really freezes. Polling or LIMITED results must not refresh
    // its last-frame timestamp without a change in video.currentTime.
    fixture.setTime(22100);
    fixture.emit({ trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' }, { newVideoFrame: false });
    fixture.tracker.update();
    assert.equal(fixture.tracker.active, false);
    assert.equal(fixture.callbacks.stop.length, 1);
    assert.equal(fixture.sourceStream.track.stopped > 0, true);
  } finally { fixture.tracker.dispose(); }
});

test('cancelling engine loading is settled immediately and cannot start an old session later', async () => {
  let resolveEngine;
  const pendingEngine = new Promise(resolve => { resolveEngine = resolve; });
  const fixture = createFixture({ loadEngine: () => pendingEngine });
  try {
    const oldStart = fixture.tracker.start();
    fixture.tracker.stop();
    assert.equal(await oldStart, false);
    const newStart = fixture.tracker.start();
    resolveEngine(fixture.engine);
    assert.equal(await newStart, true);
    assert.equal(fixture.engine.runs.length, 1);
    assert.equal(fixture.stage.canvases.length, 1);
    assert.equal(fixture.tracker.active, true);
  } finally { fixture.tracker.dispose(); }
});

test('stale SDK callbacks cannot mutate a newer session and close only their late stream', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    const oldModule = fixture.history[0];
    fixture.tracker.stop();
    await fixture.tracker.start();
    fixture.emit({ position: { x: 1, y: 2, z: 3 } });
    const lateStream = stream();
    oldModule.onCameraStatusChange({ status: 'hasStream', stream: lateStream });
    oldModule.onUpdate({ processCpuResult: { reality: fixture.reality({ position: { x: 10, y: 20, z: 30 } }) } });
    oldModule.onStart({ canvasWidth: 10, canvasHeight: 10 });
    oldModule.onException(new Error('old failure'));
    assert.equal(lateStream.track.stopped, 1);
    assert.deepEqual(fixture.camera.position.toArray(), [1, 2, 3]);
    assert.equal(fixture.tracker.active, true);
    assert.equal(fixture.callbacks.stop.length, 0);
    assert.equal(fixture.engine.stops, 1);
  } finally { fixture.tracker.dispose(); }
});

test('cancelling while camera permission is pending closes a late permission grant', async () => {
  const fixture = createFixture();
  const normalRun = fixture.engine.run;
  fixture.engine.run = function (options) { this.runs.push(options); };
  try {
    const pendingStart = fixture.tracker.start();
    await new Promise(resolve => setImmediate(resolve));
    const pendingModule = fixture.history[0];
    fixture.tracker.stop();
    assert.equal(await pendingStart, false);
    assert.equal(fixture.engine.stops, 1);
    const lateStream = stream();
    pendingModule.onCameraStatusChange({ status: 'hasStream', stream: lateStream });
    pendingModule.onStart({ canvasWidth: 960, canvasHeight: 720 });
    assert.equal(lateStream.track.stopped, 1);
    assert.equal(fixture.tracker.active, false);
    fixture.engine.run = normalRun;
    assert.equal(await fixture.tracker.start(), true);
    assert.equal(fixture.tracker.active, true);
  } finally { fixture.tracker.dispose(); }
});

test('permission failure rejects startup; runtime failure stops cleanly and reports it', async () => {
  const denied = createFixture({ failCamera: true });
  try {
    await assert.rejects(denied.tracker.start(), /permisos/);
    assert.equal(denied.tracker.active, false);
    assert.equal(denied.stage.canvases[0].removed, true);
    assert.equal(denied.callbacks.stop.length, 0);
  } finally { denied.tracker.dispose(); }
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.history[0].onException(new Error('tracking failed'));
    assert.equal(fixture.tracker.active, false);
    assert.deepEqual(fixture.callbacks.stop, ['tracking failed']);
    assert.equal(fixture.sourceStream.track.stopped > 0, true);
    assert.equal(fixture.observers[0].disconnected, true);
  } finally { fixture.tracker.dispose(); }
});

test('resizing updates display geometry without resetting the world origin or anchor', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start(); fixture.engine.hits = [surface()]; fixture.emit(); fixture.tracker.placeAt();
    const fixed = fixture.anchor.position.toArray();
    fixture.stage.width = 900; fixture.stage.height = 300;
    fixture.observers[0].callback();
    assert.equal(fixture.engine.runs[0].canvas.width, 1350);
    assert.equal(fixture.engine.runs[0].canvas.height, 450);
    const configuration = fixture.engine.projections.at(-1);
    assert.deepEqual(configuration.cam, { pixelRectWidth: 1350, pixelRectHeight: 450, nearClipPlane: 0.01, farClipPlane: 30 });
    assert.equal(configuration.origin, undefined);
    assert.equal(configuration.facing, undefined);
    assert.equal(fixture.anchor.visible, false);
    fixture.emit();
    assert.equal(fixture.anchor.visible, true);
    assert.deepEqual(fixture.anchor.position.toArray(), fixed);
  } finally { fixture.tracker.dispose(); }
});

test('backgrounding closes the camera and requires an explicit new start', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.document.hidden = true; fixture.document.dispatch('visibilitychange');
    assert.equal(fixture.tracker.active, false);
    assert.equal(fixture.engine.stops, 1);
    assert.equal(fixture.callbacks.stop.length, 1);
    fixture.document.hidden = false; fixture.document.dispatch('visibilitychange');
    assert.equal(fixture.engine.runs.length, 1);
  } finally { fixture.tracker.dispose(); }
});

test('SDK compatibility rejection never opens the camera or claims spatial tracking', async () => {
  const fixture = createFixture();
  fixture.engine.XrDevice.isDeviceBrowserCompatible = ({ allowedDevices }) => {
    assert.equal(allowedDevices, 'mobile');
    return false;
  };
  try {
    await assert.rejects(fixture.tracker.start(), /no admite el seguimiento espacial/);
    assert.equal(fixture.engine.runs.length, 0);
    assert.equal(fixture.engine.chunks.length, 0);
    assert.equal(fixture.tracker.tracking, false);
    assert.equal(fixture.stage.canvases.length, 0);
  } finally { fixture.tracker.dispose(); }
});

test('SDK render callback observes the updated camera pose and ignores stale sessions', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    const module = fixture.history[0];
    fixture.emit({ position: { x: 0.5, y: 1.3, z: -0.2 } });
    module.onRender();
    assert.deepEqual(fixture.callbacks.render, [{ milliseconds: 1000,
      position: [0.5, 1.3, -0.2], projection: fixture.reality().intrinsics }]);
    fixture.tracker.stop();
    module.onRender();
    assert.equal(fixture.callbacks.render.length, 1);
    await fixture.tracker.start();
    fixture.setTime(2000);
    fixture.emit({ position: { x: -0.5, y: 1.7, z: 0.4 } });
    module.onRender();
    assert.equal(fixture.callbacks.render.length, 1, 'an old SDK module cannot render a new session');
    fixture.history[1].onRender();
    assert.deepEqual(fixture.callbacks.render[1], { milliseconds: 2000,
      position: [-0.5, 1.7, 0.4], projection: fixture.reality().intrinsics });
  } finally { fixture.tracker.dispose(); }
});

test('documented FEATURE_POINT query places the displayed off-centre 3D point without a plane', async () => {
  const fixture = createFixture();
  // A world point needs a position, not a measured surface orientation or
  // redundant distance metadata. This was rejected by the old surface filter.
  const point = { type: 'FEATURE_POINT', position: { x: 0.6, y: 0.8, z: -1.2 } };
  fixture.engine.hits = (x, y, includedTypes) => {
    assert.deepEqual(includedTypes, ['FEATURE_POINT']);
    return x === 0.65 && y === 0.5 ? [point] : [];
  };
  try {
    await fixture.tracker.start(); fixture.emit();
    const shown = fixture.callbacks.reticle.at(-1);
    assert.equal(shown.type, 'FEATURE_POINT');
    assert.deepEqual(shown.screen, { x: 0.65, y: 0.5 });
    const calls = fixture.engine.hitCalls.length;
    fixture.engine.hits = [];
    assert.equal(fixture.tracker.placeAt(), true, 'the button uses the real, recent displayed result');
    assert.equal(fixture.engine.hitCalls.length, calls, 'it must not incorrectly query the empty centre');
    assert.deepEqual(fixture.anchor.position.toArray(), [0.6, 0.8, -1.2]);
    const fixedRotation = fixture.anchor.quaternion.toArray();
    fixture.emit({ position: { x: 1, y: 1.2, z: -0.5 } });
    assert.deepEqual(fixture.anchor.position.toArray(), [0.6, 0.8, -1.2], 'a camera move cannot drag the point');
    assert.deepEqual(fixture.anchor.quaternion.toArray(), fixedRotation, 'the model must not turn toward the moving camera');
  } finally { fixture.tracker.dispose(); }
});

test('five rejected SDK points report the failing field and recover when real positions arrive', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.engine.hits = [{ type: 'FEATURE_POINT', position: null }];
    fixture.setTime(1600); fixture.emit();
    const invalid = fixture.callbacks.diagnostics.at(-1);
    assert.equal(invalid.state, 'no-target');
    assert.equal(invalid.video, 'live');
    assert.equal(invalid.engineTrackingStatus, 'NORMAL');
    assert.equal(invalid.rejection, 'invalid-hit');
    assert.equal(invalid.hitCounts.FEATURE_POINT, 5);
    assert.deepEqual(invalid.hitRejections, { position: 5 });
    assert.equal(fixture.tracker.placeAt(), false);
    assert.equal(fixture.anchor.visible, false, 'missing SDK positions never produce a fallback location');

    fixture.engine.hits = [{ type: 'FEATURE_POINT', position: new Float32Array([0.5, 0.75, -1]),
      distance: 0, rotation: { x: 0, y: 0, z: 0, w: 0 } }];
    fixture.setTime(2200); fixture.emit();
    const valid = fixture.callbacks.diagnostics.at(-1);
    assert.equal(valid.state, 'target');
    assert.equal(valid.validTargets, 5);
    assert.deepEqual(valid.hitRejections, {});
    assert.deepEqual(invalid.hitRejections, { position: 5 }, 'old diagnostic snapshots remain independent');
    assert.equal(fixture.tracker.placeAt(), true);
    assert.deepEqual(fixture.anchor.position.toArray(), [0.5, 0.75, -1]);
  } finally { fixture.tracker.dispose(); }
});

test('valid SDK surfaces are preferred while missing hits never create a fallback plane', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start();
    fixture.engine.hits = [surface({ type: 'FEATURE_POINT', distance: 0.4 }),
      surface({ type: 'ESTIMATED_SURFACE', distance: 1.1, position: { x: 1, y: 0, z: -1 } })];
    fixture.emit();
    assert.equal(fixture.callbacks.reticle.at(-1).type, 'ESTIMATED_SURFACE');
    assert.equal(fixture.tracker.placeAt(), true);
    fixture.tracker.reposition();
    fixture.engine.hits = []; fixture.setTime(1600); fixture.emit();
    assert.equal(fixture.tracker.placeAt(), false);
    assert.equal(fixture.anchor.visible, false);
    const diagnostic = fixture.callbacks.diagnostics.at(-1);
    assert.equal(diagnostic.state, 'no-target');
    assert.equal(diagnostic.rejection, 'no-hits');
    assert.equal(diagnostic.video, 'live');
    assert.equal(diagnostic.engineTrackingStatus, 'NORMAL');
  } finally { fixture.tracker.dispose(); }
});

test('initialization diagnostics are distinct from no-target tracking and reject feature points until ready', async () => {
  const fixture = createFixture();
  fixture.engine.hits = [surface({ type: 'FEATURE_POINT' })];
  try {
    await fixture.tracker.start(); fixture.setTime(1600);
    fixture.emit({ trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' });
    const initializing = fixture.callbacks.diagnostics.at(-1);
    assert.equal(initializing.state, 'initializing');
    assert.equal(initializing.engineTrackingReason, 'INITIALIZING');
    assert.equal(initializing.video, 'live');
    assert.equal(fixture.tracker.placeAt(), false);
    assert.match(fixture.callbacks.status.at(-1), /Reconociendo movimiento/);
    fixture.setTime(2200); fixture.emit();
    assert.equal(fixture.callbacks.diagnostics.at(-1).state, 'target');
    assert.ok(fixture.callbacks.diagnostics.at(-1).hitCounts.FEATURE_POINT > 0);
    assert.equal(fixture.tracker.placeAt(), true);
    fixture.setTime(2600); fixture.tracker.reposition(); fixture.tracker.update();
    assert.equal(fixture.tracker.placeAt(), false, 'stale tracking invalidates a cached point');
  } finally { fixture.tracker.dispose(); }
});

test('explicit rescan discards placement before recentering and errors survive idempotent stop', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start(); fixture.engine.hits = [surface({ type: 'FEATURE_POINT' })]; fixture.emit();
    fixture.tracker.placeAt();
    fixture.engine.XrController.recenter = () => {
      assert.equal(fixture.anchor.visible, false);
      assert.equal(fixture.tracker.placed, false);
      assert.equal(fixture.tracker.placeAt(), false);
      fixture.engine.recenters++;
    };
    assert.equal(fixture.tracker.resetTracking(), true);
    assert.equal(fixture.engine.recenters, 1);
    assert.equal(fixture.callbacks.diagnostics.at(-1).state, 'initializing');
    fixture.emit({ trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' });
    assert.equal(fixture.tracker.placeAt(), false);
    fixture.emit(); assert.equal(fixture.tracker.placeAt(), true);
    fixture.history[0].onException(new Error('test camera interruption'));
    assert.equal(fixture.callbacks.diagnostics.at(-1).state, 'error');
    fixture.tracker.stop();
    assert.equal(fixture.callbacks.diagnostics.at(-1).state, 'error');
  } finally { fixture.tracker.dispose(); }
});

test('candidate scans and diagnostic packets are throttled independently of camera updates', async () => {
  const fixture = createFixture();
  try {
    await fixture.tracker.start(); fixture.engine.hits = [surface({ type: 'FEATURE_POINT' })]; fixture.emit();
    const scans = fixture.engine.hitCalls.length;
    const diagnostics = fixture.callbacks.diagnostics.length;
    for (const time of [1016, 1032, 1050, 1080, 1100]) { fixture.setTime(time); fixture.emit(); }
    assert.equal(fixture.engine.hitCalls.length, scans);
    assert.equal(fixture.callbacks.diagnostics.length, diagnostics);
    fixture.setTime(1130); fixture.emit();
    assert.equal(fixture.engine.hitCalls.length, scans * 2);
    assert.equal(fixture.callbacks.diagnostics.length, diagnostics);
    fixture.setTime(1600); fixture.emit();
    assert.equal(fixture.callbacks.diagnostics.length, diagnostics + 1);
  } finally { fixture.tracker.dispose(); }
});
