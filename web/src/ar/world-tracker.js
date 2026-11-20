import { Matrix4 } from 'three';

const STALE_POSE_MS = 350;
const VIDEO_TIMEOUT_MS = 5000;
const STARTUP_TIMEOUT_MS = 90000;
const SURFACE_TYPES = new Set(['DETECTED_SURFACE', 'ESTIMATED_SURFACE']);
const TARGET_TYPES = new Set([...SURFACE_TYPES, 'FEATURE_POINT']);
const TARGET_SCAN_MS = 125;
const TARGET_SAMPLES = [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.65], [0.5, 0.8]];
let enginePromise;

/** Load the original, self-hosted SDK. Its binary is neither modified nor inspected. */
export function loadWorldEngine() {
  if (globalThis.XR8) return Promise.resolve(globalThis.XR8);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const base = import.meta.env?.BASE_URL ?? './';
    script.src = new URL(`${base}external/xr/xr.js`, document.baseURI).href;
    script.async = true;
    script.setAttribute('data-preload-chunks', 'slam');
    const clean = () => {
      clearTimeout(timeout);
      window.removeEventListener('xrloaded', ready);
      script.removeEventListener('error', failed);
    };
    const ready = () => {
      if (!globalThis.XR8) return;
      clean(); resolve(globalThis.XR8);
    };
    const failed = () => {
      clean(); script.remove();
      reject(new Error('No se pudo cargar el motor de RA. Comprueba tu conexión y vuelve a intentarlo.'));
    };
    const timeout = setTimeout(failed, STARTUP_TIMEOUT_MS);
    window.addEventListener('xrloaded', ready);
    script.addEventListener('error', failed, { once: true });
    document.head.append(script);
  }).catch(error => { enginePromise = undefined; throw error; });
  return enginePromise;
}

function finiteVector(value) {
  return value && ['x', 'y', 'z'].every(key => Number.isFinite(value[key]));
}

function finiteRotation(value) {
  if (!finiteVector(value) || !Number.isFinite(value.w)) return false;
  const norm = value.x ** 2 + value.y ** 2 + value.z ** 2 + value.w ** 2;
  return norm > 1e-8 && Number.isFinite(norm);
}

function readableError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Permite el acceso a la cámara y a los sensores de movimiento para usar la RA.');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'NotReadableError') {
    return new Error('No hay una cámara trasera disponible. Cierra otras aplicaciones que la estén usando.');
  }
  return error instanceof Error ? error : new Error('No se pudo iniciar el seguimiento espacial. Puedes seguir explorando en 3D.');
}

function closeStream(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

/**
 * Real 6DoF camera tracking through 8th Wall's SLAM pipeline.
 * The camera feed has its own canvas/context; the existing Three.js renderer is
 * a transparent overlay. World-space placement never follows camera movement.
 * API references: https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule
 * and https://8thwall.org/docs/api/engine/xrcontroller/hittest
 */
export class WorldTracker {
  constructor({ renderer, camera, anchor, onStatus = () => {}, onTracking = () => {},
    onPlacement = () => {}, onReticle = () => {}, onStop = () => {}, onRender = () => {}, onDiagnostics = () => {},
    engineLoader = loadWorldEngine, clock = () => performance.now(), platform = globalThis }) {
    this.renderer = renderer;
    this.camera = camera;
    this.anchor = anchor;
    this.stage = renderer.domElement.parentElement;
    this.onStatus = onStatus;
    this.onTracking = onTracking;
    this.onPlacement = onPlacement;
    this.onReticle = onReticle;
    this.onStop = onStop;
    this.onRender = onRender;
    this.onDiagnostics = onDiagnostics;
    this._loadEngine = engineLoader;
    this._clock = clock;
    this._platform = platform;
    this._document = platform.document;
    this._window = platform.window ?? platform;
    this._session = null;
    this._generation = 0;
    this._active = false;
    this._tracking = false;
    this._placed = false;
    this._projection = new Matrix4();
    this._visibility = () => {
      if (this._document.hidden && this._session) this.stop('Cámara en pausa. Activa la RA de nuevo al volver.');
    };
    this._pageHide = () => this.stop('Cámara en pausa. Activa la RA de nuevo al volver.');
    this._document.addEventListener('visibilitychange', this._visibility);
    this._window.addEventListener('pagehide', this._pageHide);
  }

  get active() { return this._active; }
  get tracking() { return this._tracking; }
  get placed() { return this._placed; }

  start() {
    if (this._session) return this._session.ready;
    if (!this._platform.isSecureContext || !this._platform.navigator?.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error('La RA necesita HTTPS y un navegador con acceso a la cámara. Abre la aplicación publicada en Chrome del teléfono.'));
    }
    const session = {
      generation: ++this._generation, engine: null, canvas: null, stream: null,
      video: null, observer: null, started: false, ownsEngine: false,
      settled: false, lastPose: -Infinity, lastVideoTime: -1,
      lastVideoFrame: this._clock(), projectionSize: '', reticle: null,
      lastScan: -Infinity, hitCounts: {}, validTargets: 0, rawHits: 0,
      engineTrackingStatus: null, engineTrackingReason: null, lastDiagnosticAt: -Infinity,
    };
    session.ready = new Promise((resolve, reject) => { session.resolve = resolve; session.reject = reject; });
    this._session = session;
    this.anchor.visible = false;
    this._setTracking(false);
    this._setPlaced(false);
    this.onReticle(null);
    this._status('Preparando seguimiento espacial. La primera carga puede tardar…');
    this._diagnostic(session, 'loading', null, true);
    session.timeout = setTimeout(() => this._fail(session,
      new Error('La RA tardó demasiado en iniciar. Revisa la conexión, la cámara y los permisos de movimiento.')), STARTUP_TIMEOUT_MS);
    void this._start(session);
    return session.ready;
  }

  async _start(session) {
    try {
      const engine = await this._loadEngine();
      if (!this._current(session)) return;
      session.engine = engine;
      const allowedDevices = engine.XrConfig.device().MOBILE;
      if (engine.XrDevice?.isDeviceBrowserCompatible?.({ allowedDevices }) === false) {
        throw new Error('Este navegador o dispositivo no admite el seguimiento espacial. Prueba Chrome actualizado en un Android con cámara y sensores de movimiento.');
      }
      await engine.loadChunk('slam');
      if (!this._current(session)) return;
      const canvas = this._document.createElement('canvas');
      session.canvas = canvas;
      canvas.className = 'world-camera';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        zIndex: '0', pointerEvents: 'none', display: 'block',
      });
      this.stage.prepend(canvas);
      this._resize(session);
      const Observer = this._window.ResizeObserver;
      if (Observer) {
        session.observer = new Observer(() => this._resize(session));
        session.observer.observe(this.stage);
      }
      // Educational content needs consistent relative 6DoF, not a metric scale
      // estimate. Responsive is the SDK default; it does not disable SLAM.
      engine.XrController.configure({ disableWorldTracking: false, enableLighting: false,
        enableWorldPoints: false, scale: 'responsive' });
      const module = this._pipeline(session);
      session.ownsEngine = true;
      engine.clearCameraPipelineModules();
      engine.addCameraPipelineModules([
        engine.GlTextureRenderer.pipelineModule(),
        engine.XrController.pipelineModule(),
        module,
      ]);
      this._status('Permite la cámara y los sensores de movimiento cuando el navegador lo solicite.');
      this._diagnostic(session, 'camera', null, true);
      engine.run({ canvas, ownRunLoop: true,
        cameraConfig: { direction: engine.XrConfig.camera().BACK },
        // ANY allows a desktop 3D fallback in 8th Wall. Requiring MOBILE avoids
        // presenting that fallback as real world tracking.
        allowedDevices,
        glContextConfig: { alpha: false, antialias: false, preserveDrawingBuffer: false },
      });
    } catch (error) {
      this._fail(session, readableError(error));
    }
  }

  _pipeline(session) {
    return {
      name: 'neuroar-world-tracking',
      onStart: ({ canvasWidth, canvasHeight }) => {
        if (!this._current(session)) return;
        session.started = true;
        this._active = true;
        this._syncProjection(session, canvasWidth, canvasHeight, true);
        this._settle(session, true);
        this._status('Reconociendo movimiento. Desplaza el teléfono lentamente de lado frente a una zona con detalles.');
        this._diagnostic(session, 'initializing', 'no-reality', true);
      },
      onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
        if (this._current(session)) this._syncProjection(session, canvasWidth, canvasHeight);
      },
      onCameraStatusChange: ({ status, stream, video }) => {
        if (!this._current(session)) { closeStream(stream); return; }
        if (stream) {
          session.stream = stream;
          stream.getVideoTracks?.().forEach(track => track.addEventListener?.('ended', () => {
            if (this._current(session)) this._fail(session, new Error('La cámara se desconectó. Vuelve a activar la RA.'));
          }, { once: true }));
        }
        if (video) { session.video = video; session.lastVideoFrame = this._clock(); }
        if (status === 'failed') this._fail(session,
          new Error('No se pudo abrir la cámara. Revisa los permisos de cámara y movimiento del sitio.'));
      },
      onUpdate: ({ processCpuResult }) => {
        if (this._current(session)) this._acceptReality(session, processCpuResult?.reality);
      },
      onRender: () => {
        if (this._current(session) && this._active) this.onRender(this._clock());
      },
      onPaused: () => {
        if (this._current(session)) this.stop('El seguimiento se pausó. Activa la RA de nuevo para continuar.');
      },
      onException: error => this._fail(session, readableError(error)),
      onDetach: () => {
        if (this._current(session) && session.started) this.stop('Se interrumpió el seguimiento. Puedes volver a activar la RA.');
      },
    };
  }

  _resize(session) {
    if (!this._current(session) || !session.canvas) return;
    const rect = this.stage.getBoundingClientRect();
    const ratio = Math.min(this._window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (session.canvas.width === width && session.canvas.height === height) return;
    session.canvas.width = width;
    session.canvas.height = height;
    if (session.started) this._syncProjection(session, width, height);
  }

  _syncProjection(session, width, height, initial = false) {
    if (!session.started || !(width > 0 && height > 0)) return;
    const key = `${width}/${height}`;
    if (!initial && session.projectionSize === key) return;
    session.projectionSize = key;
    const parameters = { cam: { pixelRectWidth: width, pixelRectHeight: height,
      nearClipPlane: 0.01, farClipPlane: 30 } };
    // This baseline is chosen only at startup. Resizing updates display geometry
    // without resetting the SLAM origin, and reposition never recentres tracking.
    if (initial) {
      parameters.origin = { x: 0, y: 1.5, z: 0 };
      parameters.facing = { x: 0, y: 0, z: 0, w: 1 };
    }
    session.engine.XrController.updateCameraProjectionMatrix(parameters);
    this._loseTracking(session);
  }

  _videoFresh(session, now) {
    const video = session.video;
    if (!video) return true;
    if (video.readyState >= 2 && video.currentTime !== session.lastVideoTime) {
      session.lastVideoTime = video.currentTime;
      session.lastVideoFrame = now;
    }
    return video.readyState >= 2 && now - session.lastVideoFrame <= STALE_POSE_MS;
  }

  _acceptReality(session, reality) {
    if (!session.started || !this._active) return;
    const now = this._clock();
    const projection = reality?.intrinsics;
    session.engineTrackingStatus = reality?.trackingStatus ?? null;
    session.engineTrackingReason = reality?.trackingReason ?? null;
    // Camera delivery and SLAM confidence are independent. Initialization can
    // remain LIMITED for several seconds while new video frames keep arriving.
    const videoFresh = this._videoFresh(session, now);
    if (!videoFresh) { this._loseTracking(session, 'stale-video'); return; }
    if (!reality || reality.trackingStatus !== 'NORMAL' || reality.trackingReason === 'INITIALIZING') {
      this._loseTracking(session, reality ? 'tracking-limited' : 'no-reality'); return;
    }
    if (!finiteVector(reality.position) || !finiteRotation(reality.rotation)) {
      this._loseTracking(session, 'invalid-pose'); return;
    }
    if (projection?.length !== 16 || !Array.from(projection).every(Number.isFinite)) {
      this._loseTracking(session, 'invalid-projection'); return;
    }
    this._projection.fromArray(projection);
    const determinant = this._projection.determinant();
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) { this._loseTracking(session, 'invalid-projection'); return; }
    this.camera.matrixAutoUpdate = true;
    this.camera.position.copy(reality.position);
    this.camera.quaternion.copy(reality.rotation).normalize();
    this.camera.scale.setScalar(1);
    this.camera.projectionMatrix.copy(this._projection);
    this.camera.projectionMatrixInverse.copy(this._projection).invert();
    this.camera.updateMatrixWorld(true);
    session.lastPose = now;
    this._setTracking(true);
    this.anchor.visible = this._placed;
    if (this._placed) {
      this._status('Red colocada. Puedes acercarte y moverte alrededor mientras haya seguimiento.');
      this._diagnostic(session, 'placed');
    } else {
      if (now - session.lastScan >= TARGET_SCAN_MS) this._scanTargets(session);
      const target = session.reticle;
      this._status(target ? target.type === 'FEATURE_POINT'
        ? 'Punto 3D del entorno encontrado. Pulsa Colocar o toca otro punto.'
        : 'Superficie estimada encontrada. Pulsa Colocar para fijar la red.'
        : 'Movimiento reconocido. Buscando puntos del entorno; desplaza el teléfono lentamente de lado.');
      this._diagnostic(session, target ? 'target' : 'no-target', target ? null : session.rawHits ? 'invalid-hit' : 'no-hits');
    }
  }

  _surfaceAt(session, x, y, collect = false) {
    if (!this._current(session) || !this._tracking || this._clock() - session.lastPose > STALE_POSE_MS) return null;
    // FEATURE_POINT is the documented request filter. A tracked point is a
    // valid world anchor even when the SDK has not reported a whole plane.
    let hits;
    try { hits = session.engine.XrController.hitTest(x, y, ['FEATURE_POINT']) ?? []; }
    catch { return null; }
    if (!Array.isArray(hits)) return null;
    if (collect) for (const hit of hits) {
      session.rawHits++;
      const type = typeof hit?.type === 'string' && TARGET_TYPES.has(hit.type) ? hit.type : 'UNSPECIFIED';
      session.hitCounts[type] = (session.hitCounts[type] ?? 0) + 1;
    }
    const surfaces = hits.filter(hit => hit && TARGET_TYPES.has(hit.type)
      && finiteVector(hit.position) && finiteRotation(hit.rotation)
      && Number.isFinite(hit.distance) && hit.distance > 0 && hit.distance < 15);
    surfaces.sort((a, b) => Number(!SURFACE_TYPES.has(a.type)) - Number(!SURFACE_TYPES.has(b.type)) || a.distance - b.distance);
    const hit = surfaces[0];
    return hit ? { type: hit.type, position: { ...hit.position }, rotation: { ...hit.rotation }, distance: hit.distance,
      screen: { x, y }, observedAt: this._clock() } : null;
  }

  _scanTargets(session) {
    session.hitCounts = {}; session.rawHits = 0;
    const targets = TARGET_SAMPLES.map(([x, y]) => this._surfaceAt(session, x, y, true)).filter(Boolean);
    targets.sort((a, b) => Number(!SURFACE_TYPES.has(a.type)) - Number(!SURFACE_TYPES.has(b.type))
      || Math.hypot(a.screen.x - 0.5, a.screen.y - 0.5) - Math.hypot(b.screen.x - 0.5, b.screen.y - 0.5));
    session.validTargets = targets.length;
    session.lastScan = this._clock();
    session.reticle = targets[0] ?? null;
    this.onReticle(session.reticle);
  }

  placeAt(x, y) {
    const session = this._session;
    if (!session || this._placed || !this._active || !this._tracking
      || this._clock() - session.lastPose > STALE_POSE_MS) return false;
    const cached = x === undefined && y === undefined;
    if (!cached && (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)) return false;
    // The button must place the point actually displayed, including off-centre
    // samples. Expired results are never used to invent a fresh placement.
    let hit = cached ? session.reticle : this._surfaceAt(session, x, y);
    if (cached && hit && this._clock() - hit.observedAt > STALE_POSE_MS) hit = null;
    if (!hit || !this._current(session)) {
      this._status('Aún no hay un punto 3D válido ahí. Desplaza el teléfono lentamente y espera al indicador.');
      return false;
    }
    this.anchor.matrixAutoUpdate = true;
    this.anchor.position.copy(hit.position);
    this.anchor.quaternion.copy(hit.rotation).normalize();
    this.anchor.scale.setScalar(1);
    this.anchor.updateMatrixWorld(true);
    this._setPlaced(true);
    this.anchor.visible = true;
    session.reticle = null;
    this.onReticle(null);
    this._status('Red colocada. Acércate o muévete alrededor para explorarla.');
    this._diagnostic(session, 'placed', null, true);
    return true;
  }

  reposition() {
    if (!this._session) return;
    this.anchor.visible = false;
    this._setPlaced(false);
    this._session.reticle = null;
    this._session.lastScan = -Infinity;
    this.onReticle(null);
    this._status('Busca otro punto del entorno y toca para colocar la red.');
    this._diagnostic(this._session, 'tracking', null, true);
  }

  resetTracking() {
    const session = this._session;
    if (!session || !this._active) return false;
    this.reposition();
    this._setTracking(false);
    session.lastPose = -Infinity;
    session.engineTrackingStatus = 'LIMITED';
    session.engineTrackingReason = 'INITIALIZING';
    try { session.engine.XrController.recenter(); }
    catch (error) { this._fail(session, readableError(error)); return false; }
    this._status('Reconocimiento reiniciado. Desplaza el teléfono lentamente de lado para reconocer detalles.');
    this._diagnostic(session, 'initializing', 'tracking-limited', true);
    return true;
  }

  update() {
    const session = this._session;
    if (!session || !this._active) return;
    const now = this._clock();
    // Also observe the video when the SDK has not produced a reality result.
    // Only a changed currentTime counts as a frame; polling cannot keep a
    // frozen stream alive or make an old pose current.
    const videoFresh = this._videoFresh(session, now);
    if (!videoFresh || now - session.lastPose > STALE_POSE_MS) this._loseTracking(session, videoFresh ? 'no-reality' : 'stale-video');
    if (session.video && now - session.lastVideoFrame > VIDEO_TIMEOUT_MS) {
      this._fail(session, new Error('La cámara dejó de enviar imágenes. Activa de nuevo la RA.'));
    }
  }

  _loseTracking(session, rejection = 'tracking-limited') {
    if (!this._current(session)) return;
    this.anchor.visible = false;
    session.reticle = null;
    session.validTargets = 0;
    session.hitCounts = {};
    session.rawHits = 0;
    session.lastScan = -Infinity;
    this.onReticle(null);
    this._setTracking(false);
    const initializing = !session.engineTrackingStatus || session.engineTrackingReason === 'INITIALIZING';
    this._status(rejection === 'stale-video' ? 'Esperando una imagen reciente de la cámara.'
      : initializing ? 'Reconociendo movimiento. Desplaza el teléfono lentamente de lado frente a una zona con detalles.'
        : 'Seguimiento limitado. Desplaza el teléfono lentamente frente a una zona con detalles.');
    this._diagnostic(session, initializing ? 'initializing' : 'limited', rejection);
  }

  _diagnostic(session, state, rejection = null, force = false) {
    if (!session || (!this._current(session) && state !== 'stopped' && state !== 'error')) return;
    const now = this._clock();
    if (!force && now - session.lastDiagnosticAt < 500) return;
    session.lastDiagnosticAt = now;
    const video = session.video;
    const cameraState = !video ? 'unknown' : video.readyState < 2 ? 'waiting'
      : now - session.lastVideoFrame <= STALE_POSE_MS ? 'live' : 'stalled';
    this.onDiagnostics({
      state, reason: session.engineTrackingReason, video: cameraState,
      hitCounts: { ...session.hitCounts }, validTargets: session.validTargets,
      lastPoseAgeMs: Number.isFinite(session.lastPose) ? Math.max(0, now - session.lastPose) : null,
      engineTrackingStatus: session.engineTrackingStatus,
      engineTrackingReason: session.engineTrackingReason,
      rejection,
    });
  }

  _setTracking(value) {
    if (this._tracking === value) return;
    this._tracking = value;
    this.onTracking(value);
  }

  _status(message) {
    if (this._lastStatus === message) return;
    this._lastStatus = message;
    this.onStatus(message);
  }

  _setPlaced(value) {
    if (this._placed === value) return;
    this._placed = value;
    this.onPlacement(value);
  }

  _settle(session, value, error) {
    if (session.settled) return;
    session.settled = true;
    clearTimeout(session.timeout);
    if (error) session.reject(error); else session.resolve(value);
  }

  _current(session) { return this._session === session && this._generation === session.generation; }

  _fail(session, error) {
    if (!this._current(session)) return;
    const message = readableError(error).message;
    const wasStarted = session.started;
    this._settle(session, false, readableError(error));
    this.stop();
    this._status(message);
    this._diagnostic(session, 'error', null, true);
    if (wasStarted) this.onStop(message);
  }

  stop(reason) {
    const session = this._session;
    this._session = null;
    this._generation += 1;
    this._active = false;
    this.anchor.visible = false;
    this._setTracking(false);
    this._setPlaced(false);
    this.onReticle(null);
    if (session) {
      this._settle(session, false);
      session.observer?.disconnect();
      // Stop first, then remove callbacks. A late callback still has a stale
      // generation and only closes the stream belonging to that old request.
      if (session.ownsEngine) {
        try { session.engine.stop(); }
        catch (error) { console.warn('NeuroAR: el motor no pudo finalizar normalmente.', error); }
        try { session.engine.clearCameraPipelineModules(); }
        catch (error) { console.warn('NeuroAR: no se pudieron retirar los módulos de RA.', error); }
      }
      closeStream(session.stream);
      session.canvas?.remove();
      session.reticle = null;
      session.validTargets = 0;
      this._diagnostic(session, 'stopped', null, true);
    }
    if (reason && session) { this._status(reason); this.onStop(reason); }
  }

  dispose() {
    this.stop();
    this._document.removeEventListener('visibilitychange', this._visibility);
    this._window.removeEventListener('pagehide', this._pageHide);
  }
}
