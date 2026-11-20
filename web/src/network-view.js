import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SpatialInspector } from './spatial-inspector.js';
import { SpatialLearning } from './spatial-learning.js';

const NODE_DEFINITIONS = [
  { layer: 0, index: 0, name: 'x₁', spoken: 'Entrada 1', position: [-1.65, 0.5, 0] },
  { layer: 0, index: 1, name: 'x₂', spoken: 'Entrada 2', position: [-1.65, -0.5, 0] },
  { layer: 1, index: 0, name: 'h₁', spoken: 'Neurona oculta 1', position: [0, 0.85, -0.15] },
  { layer: 1, index: 1, name: 'h₂', spoken: 'Neurona oculta 2', position: [0, 0.3, 0.15] },
  { layer: 1, index: 2, name: 'h₃', spoken: 'Neurona oculta 3', position: [0, -0.3, -0.15] },
  { layer: 1, index: 3, name: 'h₄', spoken: 'Neurona oculta 4', position: [0, -0.85, 0.15] },
  { layer: 2, index: 0, name: 'ŷ', spoken: 'Neurona de salida', position: [1.65, 0, 0] },
];
const COLORS = { input: 0x369ba3, hidden: 0x916bbb, output: 0xc3c447, positive: 0x3c9691, negative: 0xcc814c, selected: 0xd5e8a0 };
const UNIT_Y = new THREE.Vector3(0, 1, 0);

/** Three.js graph and touch exploration; the mathematical model lives elsewhere. */
export class NetworkView {
  constructor({ stage, onSelect }) {
    if (!stage) throw new TypeError('A stage element is required.');
    this.stage = stage;
    this.onSelect = onSelect;
    this.onPlace = null;
    this.onFrame = null;
    this.onError = null;
    this.onInspectorAction = null;
    this.available = false;
    this.isArMode = false;
    this.placed = false;
    this.modelScale = 1;
    this.lastTrackedFrame = -Infinity;
    this.disposed = false;
    this.selection = { kind: 'neuron', layer: 1, index: 0 };
    this.scene = new THREE.Scene();
    this.previewCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.arCamera = new THREE.Camera();
    this.scene.add(this.arCamera);
    this.camera = this.previewCamera;
    this.anchor = new THREE.Group();
    this.anchor.visible = false;
    this.scene.add(this.anchor);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.nodes = [];
    this.connections = [];
    this.geometries = new Set();
    this.materials = new Set();
    this.textures = new Set();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.point = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.pointers = new Map();
    this.multiPointerGesture = false;
    this.pulseStarted = -Infinity;
    this.labels = stage.querySelector('#node-labels') ?? document.createElement('div');
    if (!this.labels.parentElement) stage.append(this.labels);
    this.labels.id = 'node-labels';
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });

    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
      const message = stage.querySelector('#webgl-error');
      if (message) {
        message.hidden = false;
        message.textContent = 'No se pudo iniciar la vista 3D. Prueba Chrome actualizado con la aceleración gráfica activada. Puedes seguir explorando los valores del inspector.';
      }
      this.initializationError = error;
      return;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    stage.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.previewCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 42;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI - 0.35;
    this.scene.add(new THREE.HemisphereLight(0xf7ffff, 0x697c78, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(-3, 5, 7);
    this.scene.add(light);
    this.grid = new THREE.GridHelper(8, 32, 0xa9bfba, 0xcbdad5);
    this.grid.position.y = -1.25;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.12;
    this.geometries.add(this.grid.geometry);
    this.materials.add(this.grid.material);
    this.scene.add(this.grid);
    this.buildGraph();
    this.buildReticle();
    this.inspector = new SpatialInspector();
    this.content.add(this.inspector.root);
    this.learning = new SpatialLearning(); this.content.add(this.learning.root);
    this.signalStep = null;
    this.bindPointers();
    // Coalesce layout changes into the render loop. Resizing the canvas inside
    // a ResizeObserver delivery can trigger another layout notification.
    this.resizeObserver = new ResizeObserver(() => { this.resizePending = true; });
    this.resizeObserver.observe(stage);
    this.resize();
    this.resetView();
    this.available = true;
    this.animate = this.animate.bind(this);
    this.frameId = requestAnimationFrame(this.animate);
  }

  buildGraph() {
    const sphere = this.geometry(new THREE.SphereGeometry(0.135, 28, 20));
    const halo = this.geometry(new THREE.SphereGeometry(0.19, 18, 12));
    const cylinder = this.geometry(new THREE.CylinderGeometry(1, 1, 1, 8));
    for (const definition of NODE_DEFINITIONS) {
      const selection = { kind: 'neuron', layer: definition.layer, index: definition.index };
      const color = definition.layer === 0 ? COLORS.input : definition.layer === 1 ? COLORS.hidden : COLORS.output;
      const material = this.material(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.34, metalness: 0.08 }));
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.set(...definition.position);
      mesh.userData.selection = selection;
      this.content.add(mesh);
      const ring = new THREE.Mesh(halo, this.material(new THREE.MeshBasicMaterial({ color: COLORS.selected, wireframe: true, transparent: true, opacity: 0.36, depthWrite: false })));
      ring.position.copy(mesh.position);
      ring.visible = false;
      this.content.add(ring);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'node-label';
      button.dataset.layer = definition.layer;
      Object.assign(button.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto' });
      const name = document.createElement('span');
      name.className = 'node-name';
      name.textContent = definition.name;
      Object.assign(name.style, { marginLeft: '0', opacity: '1' });
      const value = document.createElement('span');
      value.className = 'node-value';
      value.textContent = '0.000';
      button.append(name, value);
      button.addEventListener('click', () => this.choose(selection));
      button.setAttribute('aria-label', definition.spoken);
      this.labels.append(button);
      this.nodes.push({ ...definition, selection, mesh, ring, material, button, value, color: new THREE.Color(color), activation: 0 });
      const canvas = document.createElement('canvas');
      canvas.width = 384; canvas.height = 160;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      this.textures.add(texture);
      const sprite = new THREE.Sprite(this.material(new THREE.SpriteMaterial({ map: texture, toneMapped: false, depthWrite: false })));
      sprite.userData.selection = selection;
      sprite.position.copy(mesh.position); sprite.position.y -= 0.28;
      sprite.scale.set(0.58, 0.24, 1);
      sprite.visible = false;
      this.content.add(sprite);
      Object.assign(this.nodes.at(-1), { sprite, labelCanvas: canvas, labelTexture: texture });
    }
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < 2; i++) this.addConnection(cylinder, this.nodes[i], this.nodes[h + 2], { kind: 'connection', layer: 1, target: h, source: i });
      this.addConnection(cylinder, this.nodes[h + 2], this.nodes[6], { kind: 'connection', layer: 2, target: 0, source: h });
    }
    this.layerLabels = [
      { name: 'ENTRADA', point: new THREE.Vector3(-1.65, 1.35, 0) },
      { name: 'CAPA OCULTA', point: new THREE.Vector3(0, 1.35, 0) },
      { name: 'SALIDA', point: new THREE.Vector3(1.65, 1.35, 0) },
    ].map(item => {
      const element = document.createElement('span');
      element.className = 'network-layer-label layer-label';
      element.textContent = item.name;
      Object.assign(element.style, { position: 'absolute', left: '0', top: '0' });
      this.labels.append(element);
      return { ...item, element };
    });
    this.select(this.selection);
  }

  addConnection(geometry, from, to, selection) {
    const direction = new THREE.Vector3().subVectors(to.mesh.position, from.mesh.position);
    const length = direction.length() - 0.27;
    const group = new THREE.Group();
    group.position.addVectors(from.mesh.position, to.mesh.position).multiplyScalar(0.5);
    group.quaternion.setFromUnitVectors(UNIT_Y, direction.normalize());
    this.content.add(group);
    const material = this.material(new THREE.MeshBasicMaterial({ color: COLORS.positive, transparent: true, opacity: 0.7 }));
    const solid = new THREE.Mesh(geometry, material);
    solid.userData.selection = selection;
    group.add(solid);
    const dashes = [];
    for (let i = 0; i < 9; i++) {
      const dash = new THREE.Mesh(geometry, material);
      dash.position.y = ((i + 0.5) / 9 - 0.5) * length;
      dash.userData.selection = selection;
      group.add(dash);
      dashes.push(dash);
    }
    // A slightly larger transparent target makes thin connections usable by touch.
    const hit = new THREE.Mesh(geometry, this.material(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })));
    hit.scale.set(0.055, length, 0.055);
    hit.userData.selection = selection;
    group.add(hit);
    this.connections.push({ group, solid, dashes, hit, material, selection, length, weight: 0 });
  }

  buildReticle() {
    this.reticle = new THREE.Group();
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    const material = this.material(new THREE.MeshBasicMaterial({
      color: COLORS.selected,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }));
    this.reticleSurface = new THREE.Group();
    this.reticle.add(this.reticleSurface);
    const ring = new THREE.Mesh(this.geometry(new THREE.RingGeometry(0.055, 0.065, 48)), material);
    ring.rotation.x = -Math.PI / 2;
    this.reticleSurface.add(ring);
    const center = new THREE.Mesh(this.geometry(new THREE.CircleGeometry(0.009, 24)), material);
    center.rotation.x = -Math.PI / 2;
    this.reticleSurface.add(center);
    this.reticlePoint = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(0.028, 12, 8)),
      this.material(new THREE.MeshBasicMaterial({ color: COLORS.selected, wireframe: true,
        transparent: true, opacity: 0.95, depthWrite: false })));
    this.reticlePoint.visible = false;
    this.reticle.add(this.reticlePoint);
  }

  geometry(value) { this.geometries.add(value); return value; }
  material(value) { this.materials.add(value); return value; }

  render(network, snapshot) {
    if (!this.available) return;
    for (const node of this.nodes) {
      node.activation = node.layer === 0 ? snapshot.inputs[node.index] : node.layer === 1 ? snapshot.hiddenActivations[node.index] : snapshot.output;
      node.enabled = network.isNeuronEnabled(node.layer, node.index);
      node.material.opacity = node.enabled ? 1 : 0.25;
      node.material.transparent = !node.enabled; node.material.depthWrite = node.enabled;
      const value = node.activation.toFixed(3);
      node.value.textContent = value;
      const labelText = `${node.name}  ${node.enabled ? value : 'cortada'}`;
      if (node.labelText !== labelText) {
        node.labelText = labelText;
        const ctx = node.labelCanvas.getContext('2d');
        ctx.clearRect(0, 0, 384, 160);
        ctx.fillStyle = '#102f31'; ctx.beginPath(); ctx.roundRect(2, 12, 380, 136, 20); ctx.fill();
        ctx.fillStyle = '#edfae7'; ctx.font = '500 56px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(labelText, 192, 101);
        node.labelTexture.needsUpdate = true;
      }
      node.button.setAttribute('aria-label', `${node.spoken}, valor ${value}`);
      node.material.color.copy(node.color).multiplyScalar(0.64 + Math.min(1, Math.abs(node.activation)) * 0.36);
    }
    for (const connection of this.connections) {
      const { layer, target, source } = connection.selection;
      connection.weight = network.getWeight(layer, target, source);
      connection.enabled = network.isConnectionEnabled(layer, target, source);
      this.styleConnection(connection);
    }
  }

  styleConnection(connection) {
    const selected = sameSelection(this.selection, connection.selection);
    connection.material.color.set(connection.enabled === false ? 0x6c8181 : selected ? COLORS.selected : connection.weight < 0 ? COLORS.negative : COLORS.positive);
    connection.material.opacity = connection.enabled === false ? 0.22 : selected ? 1 : 0.68;
    const radius = (0.009 + Math.min(Math.abs(connection.weight), 8) * 0.005) * (selected ? 1.45 : 1);
    connection.solid.visible = connection.weight >= 0 && connection.enabled !== false;
    connection.solid.scale.set(radius, connection.length, radius);
    for (const dash of connection.dashes) {
      dash.visible = connection.weight < 0 || connection.enabled === false;
      dash.scale.set(radius, connection.length / 9 * 0.57, radius);
    }
  }

  select(selection) {
    this.selection = selection;
    for (const node of this.nodes) {
      const selected = sameSelection(selection, node.selection);
      node.ring.visible = selected;
      node.button.classList.toggle('is-selected', selected);
      node.button.classList.toggle('active', selected);
      node.button.setAttribute('aria-pressed', String(selected));
    }
    for (const connection of this.connections) this.styleConnection(connection);
  }

  choose(selection) {
    if (this.isArMode && (!this.placed || !this.anchor.visible)) return false;
    this.select(selection);
    this.onSelect?.(selection);
    const point = this.nodes.find(node => node.layer === selection.layer && node.index === (selection.kind === 'neuron' ? selection.index : selection.target))?.mesh.position;
    if (point) {
      this.inspector.openAt(point, this.isArMode);
      if (this.isArMode) this.inspector.fitForReading(this.camera);
    }
    return true;
  }

  setInspectorData(data) { this.inspector?.setData(data); }

  setLearningData(data) {
    if (!this.learning) return;
    const selection = this.selection;
    const point = this.nodes.find(node => node.layer === selection.layer && node.index === (selection.kind === 'neuron' ? selection.index : selection.target))?.mesh.position;
    this.learningData = data;
    this.learning.update({ ...data, point: point ?? new THREE.Vector3() });
    if (data.inside) this.inspector.close();
    const layout = `${Boolean(data.inside)}-${Boolean(data.compare)}-${Boolean(data.map)}`;
    if (layout !== this.learningLayout && !this.isArMode) this.resetView();
    this.learningLayout = layout;
  }

  setSignalStep(step) { this.signalStep = step; }

  closeLearning() { this.inspector?.close(); this.learning?.close(); }

  pulse() { this.pulseStarted = performance.now() / 1000; }

  setArMode(enabled) {
    if (!this.available || this.isArMode === enabled) return;
    this.isArMode = enabled;
    this.lastTrackedFrame = -Infinity;
    this.camera = enabled ? this.arCamera : this.previewCamera;
    this.controls.enabled = !enabled;
    this.grid.visible = !enabled;
    this.anchor.visible = false;
    this.placed = false;
    this.inspector.close();
    this.learning.close();
    if (this.reticle) this.reticle.visible = false;
    if (enabled) {
      this.anchor.add(this.content);
      this.content.position.set(0, 0.25 * this.modelScale, 0);
      this.content.rotation.set(0, 0, 0);
      this.content.scale.setScalar(0.2 * this.modelScale);
    } else {
      this.scene.add(this.content);
      this.content.position.set(0, 0, 0);
      this.content.rotation.set(0, 0, 0);
      this.content.scale.setScalar(1);
    }
    this.content.updateMatrixWorld(true);
  }

  /** Placement and camera tracking are independent: losing tracking never re-places the model. */
  setPlacementState(placed) {
    this.placed = Boolean(placed);
    if (!this.placed) this.inspector?.close();
    if (!this.placed) this.learning?.close();
    if (!this.placed) this.anchor.visible = false;
    if (this.reticle && this.placed) this.reticle.visible = false;
  }

  /** Surface hits use a ring; tracked feature points use a spatial dot. */
  setReticle(pose) {
    if (!this.reticle) return;
    const position = pose?.position;
    if (!this.isArMode || this.placed || !position || ![position.x, position.y, position.z].every(Number.isFinite)) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.position.set(position.x, position.y, position.z);
    const point = pose.type === 'FEATURE_POINT';
    this.reticlePoint.visible = point;
    this.reticleSurface.visible = !point;
    const rotation = pose.rotation;
    if (rotation && [rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite) && Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) > 0) {
      this.reticle.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    } else this.reticle.quaternion.identity();
    this.reticle.visible = true;
    this.reticle.updateMatrixWorld(true);
  }

  setModelScale(factor) {
    if (!Number.isFinite(factor)) throw new RangeError('Model scale must be finite.');
    this.modelScale = THREE.MathUtils.clamp(factor, 0.5, 2);
    if (this.isArMode) {
      this.content.scale.setScalar(0.2 * this.modelScale);
      this.content.position.y = 0.25 * this.modelScale;
      this.content.updateMatrixWorld(true);
    }
    return this.modelScale;
  }

  resetView() {
    if (!this.renderer) return;
    const aspect = Math.max(0.2, this.previewCamera.aspect);
    const teaching = this.learningData;
    if (teaching?.inside || teaching?.compare || teaching?.map) {
      const focused = teaching.inside && !teaching.compare && !teaching.map;
      const left = teaching.inside ? Math.min(-2.3, this.learning.inside.position.x - 3.6) : -2.3;
      const right = Math.max(teaching.compare ? 6.2 : 2.3, teaching.inside ? this.learning.inside.position.x + 3.3 : 2.3);
      const bottom = focused ? this.learning.inside.position.y - 1.8 : teaching.map ? -4.6 : teaching.compare ? -2.4 : -1.8;
      const top = teaching.inside ? this.learning.inside.position.y + 2.6 : teaching.compare ? 2.8 : 1.8;
      const distance = Math.max((right - left) / aspect, top - bottom) * 0.58 / Math.tan(THREE.MathUtils.degToRad(20));
      this.controls.target.set((left + right) / 2, (top + bottom) / 2, 0);
      this.previewCamera.position.copy(this.controls.target).add(new THREE.Vector3(0.1, 0.05, distance));
      this.controls.update(); return;
    }
    const distance = Math.max(1.65, 2.25 / aspect) / Math.tan(THREE.MathUtils.degToRad(20));
    this.previewCamera.position.set(distance * 0.04, distance * 0.025, distance);
    this.controls.target.set(0, 0.14, 0);
    this.controls.update();
  }

  resize() {
    if (!this.renderer) return;
    this.width = Math.max(1, this.stage.clientWidth);
    this.height = Math.max(1, this.stage.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.previewCamera.aspect = this.width / this.height;
    this.previewCamera.updateProjectionMatrix();
    const fit = Math.max(1.65, 2.25 / Math.max(0.2, this.previewCamera.aspect));
    if (!this.hasSized) { this.resetView(); this.hasSized = true; }
    else {
      // Retain orbit and relative zoom when a phone rotates or the layout narrows.
      this.previewCamera.position.sub(this.controls.target).multiplyScalar(fit / this.previousFit).add(this.controls.target);
      this.controls.update();
    }
    this.previousFit = fit;
  }

  bindPointers() {
    this.pointerDown = event => {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
      if (this.pointers.size > 1) this.multiPointerGesture = true;
    };
    this.pointerMove = event => {
      const start = this.pointers.get(event.pointerId);
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) start.moved = true;
    };
    this.pointerUp = event => {
      const start = this.pointers.get(event.pointerId);
      const pick = start && !start.moved && !this.multiPointerGesture;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size === 0) this.multiPointerGesture = false;
      if (pick) this.pick(event.clientX, event.clientY);
    };
    this.pointerCancel = event => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size === 0) this.multiPointerGesture = false;
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerCancel);
  }

  pick(clientX, clientY) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return false;
    const normalizedX = (clientX - bounds.left) / bounds.width;
    const normalizedY = (clientY - bounds.top) / bounds.height;
    if (this.isArMode && !this.placed) {
      if (!this.onPlace) return false;
      this.onPlace(normalizedX, normalizedY);
      return true;
    }
    if (this.isArMode && !this.anchor.visible) return false;
    this.pointer.set(normalizedX * 2 - 1, -normalizedY * 2 + 1);
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    if (this.isArMode) {
      // World tracking supplies a calibrated projection and six-degree camera pose.
      this.arCamera.projectionMatrixInverse.copy(this.arCamera.projectionMatrix).invert();
      const origin = new THREE.Vector3().setFromMatrixPosition(this.arCamera.matrixWorld);
      this.direction.set(this.pointer.x, this.pointer.y, 0.5).unproject(this.arCamera).sub(origin).normalize();
      this.raycaster.set(origin, this.direction);
    } else this.raycaster.setFromCamera(this.pointer, this.previewCamera);
    this.raycaster.camera = this.camera;
    const learningHit = this.learning.hitTest(this.raycaster);
    if (learningHit) { this.onInspectorAction?.(learningHit); return true; }
    const cardHit = this.inspector.hitTest(this.raycaster);
    if (cardHit) {
      this.inspector.activate(cardHit.action);
      if (['close', 'increase', 'decrease', 'open-neuron', 'toggle-connection'].includes(cardHit.action)) this.onInspectorAction?.(cardHit.action);
      return true;
    }
    this.raycaster.camera = this.camera;
    const nodeHits = this.raycaster.intersectObjects(this.nodes.flatMap(node => node.sprite.visible ? [node.mesh, node.sprite] : [node.mesh]), false);
    if (nodeHits.length) return this.choose(nodeHits[0].object.userData.selection);
    const connectionHits = this.raycaster.intersectObjects(this.connections.map(connection => connection.hit), false);
    if (connectionHits.length) return this.choose(connectionHits[0].object.userData.selection);
    return false;
  }

  animate(milliseconds) {
    if (this.disposed) return;
    if (this.resizePending) { this.resizePending = false; this.resize(); }
    const seconds = milliseconds / 1000;
    try { this.onFrame?.(seconds); }
    catch (error) {
      this.onFrame = null;
      if (this.onError) this.onError(error);
      else console.error('NeuroAR frame update failed:', error);
    }
    // During tracking, draw only from the SDK's camera-render callback. Keep
    // this loop alive for watchdogs and to clear a stale or stopped AR frame.
    if (!this.isArMode || milliseconds - this.lastTrackedFrame > 100) this.drawSceneFrame(milliseconds);
    this.frameId = requestAnimationFrame(this.animate);
  }

  renderTrackedFrame(milliseconds = performance.now()) {
    if (!this.available || !this.isArMode || this.disposed) return;
    this.lastTrackedFrame = milliseconds;
    this.drawSceneFrame(milliseconds);
  }

  drawSceneFrame(milliseconds = performance.now()) {
    if (!this.available || this.disposed) return;
    if (!this.isArMode) this.controls.update();
    const pulseAge = milliseconds / 1000 - this.pulseStarted;
    for (const node of this.nodes) {
      const arrival = node.layer * 0.52;
      const glow = node.enabled === false ? 0 : this.signalStep === null
        ? Math.max(0, 1 - Math.abs(pulseAge - arrival - 0.16) / 0.24)
        : Number((this.signalStep === 0 && node.layer === 0) || (this.signalStep === 2 && node.layer === 1) || (this.signalStep === 4 && node.layer === 2));
      node.material.emissiveIntensity = 0.1 + Math.abs(node.activation) * 0.13 + glow * 1.5;
      node.mesh.scale.setScalar(1 + glow * 0.18);
    }
    for (const connection of this.connections) if (this.signalStep !== null && connection.enabled !== false) {
      connection.material.opacity = this.signalStep === (connection.selection.layer === 1 ? 1 : 3) ? 1 : 0.22;
    }
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.inspector.faceCamera(this.camera);
    this.learning.faceCamera(this.camera);
    const visible = !this.isArMode || (this.placed && this.anchor.visible);
    const spatialLabels = this.isArMode || this.inspector.root.visible || this.learning.inside.visible || this.learning.maps.visible || this.learning.comparison.visible;
    for (const node of this.nodes) {
      node.sprite.visible = spatialLabels;
      this.point.copy(node.mesh.position);
      this.point.y -= 0.26;
      this.content.localToWorld(this.point);
      this.projectLabel(node.button, this.point, visible && !spatialLabels);
    }
    for (const label of this.layerLabels) {
      this.point.copy(label.point);
      this.content.localToWorld(this.point);
      this.projectLabel(label.element, this.point, visible && !spatialLabels);
    }
    this.renderer.render(this.scene, this.camera);
  }

  projectLabel(element, worldPosition, enabled) {
    worldPosition.project(this.camera);
    const visible = enabled && worldPosition.z >= -1 && worldPosition.z <= 1 && Math.abs(worldPosition.x) <= 0.98 && Math.abs(worldPosition.y) <= 0.96;
    element.hidden = !visible;
    element.style.display = visible ? '' : 'none';
    if (visible) element.style.transform = `translate(-50%, -50%) translate(${(worldPosition.x * 0.5 + 0.5) * this.width}px, ${(-worldPosition.y * 0.5 + 0.5) * this.height}px)`;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('pointerdown', this.pointerDown);
      canvas.removeEventListener('pointermove', this.pointerMove);
      window.removeEventListener('pointerup', this.pointerUp);
      window.removeEventListener('pointercancel', this.pointerCancel);
      for (const geometry of this.geometries) geometry.dispose();
      for (const material of this.materials) material.dispose();
      for (const texture of this.textures) texture.dispose();
      this.inspector?.dispose();
      this.learning?.dispose();
      this.renderer.dispose();
      canvas.remove();
    }
    for (const node of this.nodes) node.button.remove();
    for (const label of this.layerLabels ?? []) label.element.remove();
    this.reticle?.removeFromParent();
  }
}

function sameSelection(a, b) {
  return a?.kind === b?.kind && a?.layer === b?.layer && (a?.kind === 'neuron' ? a.index === b.index : a?.target === b?.target && a?.source === b?.source);
}
