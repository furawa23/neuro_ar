import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.onFrame = null;
    this.onError = null;
    this.available = false;
    this.isArMode = false;
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
    this.controls.maxDistance = 16;
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
    this.bindPointers();
    this.resizeObserver = new ResizeObserver(() => this.resize());
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

  geometry(value) { this.geometries.add(value); return value; }
  material(value) { this.materials.add(value); return value; }

  render(network, snapshot) {
    if (!this.available) return;
    for (const node of this.nodes) {
      node.activation = node.layer === 0 ? snapshot.inputs[node.index] : node.layer === 1 ? snapshot.hiddenActivations[node.index] : snapshot.output;
      const value = node.activation.toFixed(3);
      node.value.textContent = value;
      node.button.setAttribute('aria-label', `${node.spoken}, valor ${value}`);
      node.material.color.copy(node.color).multiplyScalar(0.64 + Math.min(1, Math.abs(node.activation)) * 0.36);
    }
    for (const connection of this.connections) {
      const { layer, target, source } = connection.selection;
      connection.weight = network.getWeight(layer, target, source);
      this.styleConnection(connection);
    }
  }

  styleConnection(connection) {
    const selected = sameSelection(this.selection, connection.selection);
    connection.material.color.set(selected ? COLORS.selected : connection.weight < 0 ? COLORS.negative : COLORS.positive);
    connection.material.opacity = selected ? 1 : 0.68;
    const radius = (0.009 + Math.min(Math.abs(connection.weight), 8) * 0.005) * (selected ? 1.45 : 1);
    connection.solid.visible = connection.weight >= 0;
    connection.solid.scale.set(radius, connection.length, radius);
    for (const dash of connection.dashes) {
      dash.visible = connection.weight < 0;
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
    if (this.isArMode && !this.anchor.visible) return;
    this.select(selection);
    this.onSelect?.(selection);
  }

  pulse() { this.pulseStarted = performance.now() / 1000; }

  setArMode(enabled) {
    if (!this.available || this.isArMode === enabled) return;
    this.isArMode = enabled;
    this.camera = enabled ? this.arCamera : this.previewCamera;
    this.controls.enabled = !enabled;
    this.grid.visible = !enabled;
    this.anchor.visible = false;
    if (enabled) {
      this.anchor.add(this.content);
      this.content.position.set(0, 0.07, 0);
      this.content.rotation.set(0, 0, 0);
      this.content.scale.setScalar(0.05);
    } else {
      this.scene.add(this.content);
      this.content.position.set(0, 0, 0);
      this.content.rotation.set(0, 0, 0);
      this.content.scale.setScalar(1);
    }
    this.content.updateMatrixWorld(true);
  }

  resetView() {
    if (!this.renderer) return;
    const aspect = Math.max(0.2, this.previewCamera.aspect);
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
    if (this.isArMode && !this.anchor.visible) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return;
    this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1);
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    if (this.isArMode) {
      // AR uses a generic THREE.Camera with ARToolKit's calibrated projection.
      this.arCamera.projectionMatrixInverse.copy(this.arCamera.projectionMatrix).invert();
      const origin = new THREE.Vector3().setFromMatrixPosition(this.arCamera.matrixWorld);
      this.direction.set(this.pointer.x, this.pointer.y, 0.5).unproject(this.arCamera).sub(origin).normalize();
      this.raycaster.set(origin, this.direction);
    } else this.raycaster.setFromCamera(this.pointer, this.previewCamera);
    const nodeHits = this.raycaster.intersectObjects(this.nodes.map(node => node.mesh), false);
    if (nodeHits.length) { this.choose(nodeHits[0].object.userData.selection); return; }
    const connectionHits = this.raycaster.intersectObjects(this.connections.map(connection => connection.hit), false);
    if (connectionHits.length) this.choose(connectionHits[0].object.userData.selection);
  }

  animate(milliseconds) {
    if (this.disposed) return;
    const seconds = milliseconds / 1000;
    try { this.onFrame?.(seconds); }
    catch (error) {
      this.onFrame = null;
      if (this.onError) this.onError(error);
      else console.error('NeuroAR frame update failed:', error);
    }
    if (!this.isArMode) this.controls.update();
    const pulseAge = seconds - this.pulseStarted;
    for (const node of this.nodes) {
      const arrival = node.layer * 0.52;
      const glow = Math.max(0, 1 - Math.abs(pulseAge - arrival - 0.16) / 0.24);
      node.material.emissiveIntensity = 0.1 + Math.abs(node.activation) * 0.13 + glow * 1.5;
      node.mesh.scale.setScalar(1 + glow * 0.18);
    }
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const visible = !this.isArMode || this.anchor.visible;
    for (const node of this.nodes) {
      this.point.copy(node.mesh.position);
      this.point.y -= 0.26;
      this.content.localToWorld(this.point);
      this.projectLabel(node.button, this.point, visible);
    }
    for (const label of this.layerLabels) {
      this.point.copy(label.point);
      this.content.localToWorld(this.point);
      this.projectLabel(label.element, this.point, visible);
    }
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.animate);
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
      this.renderer.dispose();
      canvas.remove();
    }
    for (const node of this.nodes) node.button.remove();
    for (const label of this.layerLabels ?? []) label.element.remove();
  }
}

function sameSelection(a, b) {
  return a?.kind === b?.kind && a?.layer === b?.layer && (a?.kind === 'neuron' ? a.index === b.index : a?.target === b?.target && a?.source === b?.source);
}
