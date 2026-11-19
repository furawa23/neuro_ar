import { Matrix4, Quaternion, Vector3 } from 'three';
import { coverProjection, MARKER_WIDTH_MILLIMETERS, POSE_METERS_PER_UNIT, PATTERN_RATIO } from './marker-math.js';

const DETECTION_INTERVAL_MS = 1000 / 15;
const STALE_POSE_MS = 220;
const STOPPED = Symbol('camera request cancelled');

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function disposeController(controller) {
  if (!controller) return Promise.resolve();
  // The SDK queues a load event one timer tick after init resolves. Deferring
  // teardown lets that event finish before dispose nulls its listener table.
  return new Promise((resolve) => setTimeout(() => { controller.dispose(); resolve(); }, 5));
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('No se concedió acceso a la cámara. Habilita el permiso de cámara de este sitio y vuelve a intentarlo.');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return new Error('No se encontró una cámara disponible. Puedes seguir explorando la red en 3D.');
  }
  if (error?.name === 'NotReadableError') {
    return new Error('Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.');
  }
  return error instanceof Error ? error : new Error('No se pudo iniciar la cámara. Vuelve a intentarlo.');
}

function waitForVideo(video, signal) {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      signal.removeEventListener('abort', abort);
    };
    const ready = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      clean();
      resolve();
    };
    const abort = () => { clean(); reject(STOPPED); };
    const timeout = setTimeout(() => {
      clean();
      reject(new Error('La cámara no entregó una imagen. Comprueba el permiso y vuelve a intentarlo.'));
    }, 15000);
    video.addEventListener('loadeddata', ready);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/**
 * Camera-only AR for the printed 14 cm NeuroAR square. No WebXR or ARCore.
 * The anchor uses AR.js axes: X across the paper, Y normal above it, Z along it.
 * A dedicated THREE.Camera and a transparent renderer canvas are required.
 */
export class MarkerTracker {
  constructor({ renderer, camera, anchor, onStatus = () => {}, onTracking = () => {}, onStop = () => {} }) {
    this.renderer = renderer;
    this.camera = camera;
    this.anchor = anchor;
    this.stage = renderer.domElement.parentElement;
    this.onStatus = onStatus;
    this.onTracking = onTracking;
    this.onStop = onStop;
    this._session = null;
    this._active = false;
    this._tracking = false;
    this._generation = 0;
    this._matrix = new Matrix4();
    this._markerAxes = new Matrix4().makeRotationX(Math.PI / 2);
    this._position = new Vector3();
    this._quaternion = new Quaternion();
    this._scale = new Vector3();
    this._savedPosition = new Vector3();
    this._savedQuaternion = new Quaternion();
    this._visibility = () => {
      if (document.hidden && this._session) this.stop('Cámara en pausa. Activa de nuevo la RA cuando vuelvas.');
    };
    this._pageHide = () => this.stop('Cámara en pausa. Activa de nuevo la RA cuando vuelvas.');
    document.addEventListener('visibilitychange', this._visibility);
    window.addEventListener('pagehide', this._pageHide);
  }

  get active() { return this._active; }
  get tracking() { return this._tracking; }

  async start() {
    if (this._session) return this._session.ready;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('La cámara necesita HTTPS. Abre la dirección segura publicada de la aplicación; localhost solo sirve para pruebas en este equipo.');
    }
    const session = {
      generation: ++this._generation,
      abort: new AbortController(),
      video: null,
      stream: null,
      controller: null,
      initializing: true,
      ready: null,
      lastDetection: -Infinity,
      lastSeen: -Infinity,
      lastVideoTime: -1,
      lastFrame: performance.now(),
      consecutive: 0,
      projectionSize: '',
    };
    this._session = session;
    this.anchor.visible = false;
    this._setTracking(false);
    this.onStatus('Preparando cámara trasera…');
    session.ready = this._start(session);
    return session.ready;
  }

  async _start(session) {
    try {
      // getUserMedia cannot be aborted. A late permission grant must close its tracks.
      const pendingStream = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      pendingStream.then((stream) => { if (!this._current(session)) stopStream(stream); }, () => {});
      session.stream = await pendingStream;
      this._check(session);
      const video = document.createElement('video');
      session.video = video;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      video.className = 'ar-camera';
      Object.assign(video.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover',
        objectPosition: '50% 50%', pointerEvents: 'none', zIndex: '0',
      });
      this.stage.prepend(video);
      video.srcObject = session.stream;
      await video.play();
      this._check(session);
      await waitForVideo(video, session.abort.signal);
      this._check(session);

      const assetBase = `${import.meta.env.BASE_URL}markers/`;
      const [toolkitModule, cameraResponse, patternResponse] = await Promise.all([
        import('@ar-js-org/artoolkit5-js'),
        fetch(`${assetBase}camera_para.dat`, { signal: session.abort.signal }),
        fetch(`${assetBase}neuroar-marker.patt`, { signal: session.abort.signal }),
      ]);
      this._check(session);
      if (!cameraResponse.ok || !patternResponse.ok) throw new Error('No se pudieron cargar los archivos del marcador. Recarga la aplicación.');
      session.toolkit = toolkitModule.default ?? toolkitModule;
      session.cameraData = new Uint8Array(await cameraResponse.arrayBuffer());
      session.patternData = await patternResponse.text();
      this._check(session);
      await this._configureController(session);
      this._check(session);
      session.initializing = false;
      session.stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (this._current(session)) this.stop('La cámara se desconectó. Vuelve a activar la RA.');
        }, { once: true });
      });
      this._active = true;
      this._project(session);
      this.onStatus('Muestra el marcador completo y su margen blanco.');
      return true;
    } catch (error) {
      const cancelled = !this._current(session) || error === STOPPED || error?.name === 'AbortError';
      if (this._current(session)) this.stop();
      session.initializing = false;
      this._release(session);
      if (cancelled) return false;
      const readable = cameraError(error);
      this.onStatus(readable.message);
      throw readable;
    }
  }

  async _configureController(session) {
    const video = session.video;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(16, Math.round(video.videoWidth * scale));
    const height = Math.max(16, Math.round(video.videoHeight * scale));
    // No frame is being processed during a reconfiguration. Dispose before
    // awaiting so cancellation cannot strand the previous native controller.
    const oldController = session.controller;
    session.controller = null;
    await disposeController(oldController);
    this._check(session);
    const controller = await session.toolkit.ARController.initWithDimensions(width, height, session.cameraData);
    if (!this._current(session)) { void disposeController(controller); throw STOPPED; }
    session.controller = controller;
    controller.setProjectionNearPlane(0.01);
    controller.setProjectionFarPlane(10);
    controller.setPatternDetectionMode(controller.artoolkit.AR_TEMPLATE_MATCHING_MONO);
    controller.setPattRatio(PATTERN_RATIO);
    controller.setThresholdMode(controller.artoolkit.AR_LABELING_THRESH_MODE_AUTO_OTSU);
    const markerId = await controller.loadMarker(session.patternData);
    this._check(session);
    if (markerId < 0) throw new Error('No se pudo preparar el patrón de NeuroAR.');
    controller.trackPatternMarkerId(markerId, MARKER_WIDTH_MILLIMETERS);
    controller.addEventListener('getMarker', (event) => {
      if (event.data.marker.idPatt !== markerId || event.data.marker.cfPatt < 0.65) return;
      // matrixGL_RH is already converted from CV to a right-handed GL camera.
      // Its typed array is reused by the SDK, so copy it synchronously.
      this._matrix.fromArray(event.data.matrixGL_RH).multiply(this._markerAxes);
      this._matrix.elements[12] *= POSE_METERS_PER_UNIT;
      this._matrix.elements[13] *= POSE_METERS_PER_UNIT;
      this._matrix.elements[14] *= POSE_METERS_PER_UNIT;
      this._acceptPose(session);
    });
    session.sourceWidth = video.videoWidth;
    session.sourceHeight = video.videoHeight;
    session.baseProjection = Array.from(controller.getCameraMatrix());
    // SDK 0.3.2 setters store clipping values without rebuilding this matrix.
    // Camera pose translations above have already been converted to metres.
    const near = 0.01;
    const far = 10;
    session.baseProjection[10] = -(far + near) / (far - near);
    session.baseProjection[14] = -2 * far * near / (far - near);
    session.projectionSize = '';
    session.consecutive = 0;
    session.lastSeen = -Infinity;
    session.lastDetection = -Infinity;
  }

  _acceptPose(session) {
    this._matrix.decompose(this._position, this._quaternion, this._scale);
    if (!Number.isFinite(this._position.z) || this._position.z > -0.08 || this._position.z < -4) return;
    const now = performance.now();
    const gap = now - session.lastSeen;
    if (gap > STALE_POSE_MS || session.consecutive === 0) {
      session.consecutive = 1;
      this._savedPosition.copy(this._position);
      this._savedQuaternion.copy(this._quaternion);
    } else {
      session.consecutive += 1;
      const blend = 1 - Math.exp(-18 * Math.min(gap / 1000, 0.2));
      this._savedPosition.lerp(this._position, blend);
      this._savedQuaternion.slerp(this._quaternion, blend);
    }
    session.lastSeen = now;
    if (session.consecutive < 2) return;
    this.anchor.matrixAutoUpdate = true;
    this.anchor.position.copy(this._savedPosition);
    this.anchor.quaternion.copy(this._savedQuaternion);
    this.anchor.scale.setScalar(1);
    this.anchor.visible = true;
    this.anchor.updateMatrixWorld(true);
    this._setTracking(true);
    this.onStatus('Marcador visible. Toca las neuronas o las conexiones.');
  }

  _project(session) {
    const { width, height } = this.stage.getBoundingClientRect();
    if (!width || !height || !session.baseProjection) return;
    const key = `${width}/${height}/${session.sourceWidth}/${session.sourceHeight}`;
    if (session.projectionSize === key) return;
    session.projectionSize = key;
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.camera.scale.setScalar(1);
    this.camera.updateMatrixWorld(true);
    this.camera.projectionMatrix.fromArray(coverProjection(session.baseProjection,
      session.sourceWidth, session.sourceHeight, width, height));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  update() {
    const session = this._session;
    if (!this._active || !session || session.reconfiguring) return;
    this._project(session);
    const now = performance.now();
    if (now - session.lastSeen > STALE_POSE_MS) this._lose();
    if (now - session.lastDetection < DETECTION_INTERVAL_MS) return;
    const video = session.video;
    if (video.readyState < 2 || video.currentTime === session.lastVideoTime) {
      if (now - session.lastFrame > 5000) this.stop('La cámara dejó de enviar imágenes. Vuelve a activar la RA.');
      return;
    }
    session.lastVideoTime = video.currentTime;
    session.lastFrame = now;
    if (video.videoWidth !== session.sourceWidth || video.videoHeight !== session.sourceHeight) {
      session.reconfiguring = true;
      session.initializing = true;
      this._lose();
      this.onStatus('Ajustando la orientación de la cámara…');
      this._configureController(session).then(() => {
        session.initializing = false;
        session.reconfiguring = false;
        if (!this._current(session)) this._release(session);
      }).catch((error) => {
        session.initializing = false;
        this._release(session);
        if (this._current(session)) this.stop(cameraError(error).message);
      });
      return;
    }
    session.lastDetection = now;
    session.found = false;
    try {
      // Browser video frames already have their screen orientation. ARToolkit's
      // optional portrait rotation would rotate them a second time, so use its
      // default draw path at the video's actual aspect ratio.
      session.controller.process(video);
      if (now - session.lastSeen > DETECTION_INTERVAL_MS * 0.8) this._lose();
    } catch (error) {
      console.error('NeuroAR marker processing:', error);
      this.stop('No se pudo procesar la cámara. Puedes volver a activar la RA.');
    }
  }

  _lose() {
    this.anchor.visible = false;
    if (this._tracking) this.onStatus('Marcador fuera de vista. Muestra el cuadrado completo con buena luz.');
    if (this._session) this._session.consecutive = 0;
    this._setTracking(false);
  }

  _setTracking(value) {
    if (this._tracking === value) return;
    this._tracking = value;
    this.onTracking(value);
  }

  _current(session) { return this._session === session && session.generation === this._generation; }
  _check(session) { if (!this._current(session)) throw STOPPED; }

  _release(session) {
    stopStream(session.stream);
    session.stream = null;
    if (session.video) {
      session.video.pause();
      session.video.srcObject = null;
      session.video.remove();
      session.video = null;
    }
    if (session.controller && !session.initializing) {
      void disposeController(session.controller);
      session.controller = null;
    }
  }

  stop(reason) {
    const session = this._session;
    this._session = null;
    this._generation += 1;
    this._active = false;
    this.anchor.visible = false;
    this._setTracking(false);
    if (session) {
      session.abort.abort();
      this._release(session);
    }
    if (reason && session) {
      this.onStatus(reason);
      this.onStop(reason);
    }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._visibility);
    window.removeEventListener('pagehide', this._pageHide);
  }
}
