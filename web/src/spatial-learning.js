import * as THREE from 'three';

const format = value => Number(value).toFixed(3);
const BLUE = new THREE.Color('#3297ad'), LIME = new THREE.Color('#d2df78');

/** Optional teaching objects share the network anchor; none update camera pose. */
export class SpatialLearning {
  constructor({ canvasFactory = () => document.createElement('canvas') } = {}) {
    this.canvasFactory = canvasFactory;
    this.root = new THREE.Group();
    this.inside = new THREE.Group(); this.comparison = new THREE.Group(); this.maps = new THREE.Group();
    this.root.add(this.inside, this.comparison, this.maps);
    this.inside.visible = this.comparison.visible = this.maps.visible = false;
    this.resources = new Set(); this.labels = []; this.cameraRotation = new THREE.Quaternion(); this.parentRotation = new THREE.Quaternion();
    this.buildInside(); this.buildComparison(); this.buildMaps();
  }
  keep(resource) { this.resources.add(resource); return resource; }
  label(width = 1.15, height = 0.5) {
    const canvas = this.canvasFactory(); canvas.width = 512; canvas.height = 224;
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    const sprite = new THREE.Sprite(this.keep(new THREE.SpriteMaterial({ map: texture, toneMapped: false, depthWrite: false })));
    sprite.scale.set(width, height, 1);
    const item = { sprite, canvas, texture, text: '' }; this.labels.push(item); return item;
  }
  text(label, text, accent = '#e7f6df') {
    if (label.text === text) return;
    label.text = text;
    const ctx = label.canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, 512, 224);
    ctx.fillStyle = '#0b2b31'; ctx.beginPath(); ctx.roundRect(2, 2, 508, 220, 22); ctx.fill();
    const lines = String(text).split('\n').slice(0, 4), size = Math.min(68, 180 / lines.length), gap = size + 10;
    ctx.fillStyle = accent; ctx.textAlign = 'center';
    lines.forEach((line, index) => {
      let fontSize = size;
      do { ctx.font = `500 ${fontSize}px system-ui, sans-serif`; if (!ctx.measureText || ctx.measureText(line).width <= 484) break; fontSize -= 2; } while (fontSize > 22);
      ctx.fillText(line, 256, 112 - (lines.length - 1) * gap / 2 + size * 0.3 + index * gap, 484);
    });
    label.texture.needsUpdate = true;
  }
  shape(group, geometry, color, position) {
    const material = this.keep(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.45 }));
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); group.add(mesh); return mesh;
  }
  line(group, from, to, color = '#7eafa9') {
    const line = new THREE.Line(this.keep(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)])),
      this.keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })));
    group.add(line); return line;
  }
  buildInside() {
    const box = this.keep(new THREE.BoxGeometry(0.22, 0.22, 0.22));
    const sphere = this.keep(new THREE.SphereGeometry(0.19, 20, 14));
    const torus = this.keep(new THREE.TorusGeometry(0.21, 0.06, 12, 24));
    this.terms = Array.from({ length: 4 }, (_, index) => {
      const y = 1.08 - index * 0.72;
      const mesh = this.shape(this.inside, box, '#439ba6', [-1.25, y, 0]);
      const label = this.label(1.85, 0.7); label.sprite.position.set(-2.4, y, 0.2); this.inside.add(label.sprite);
      const link = this.line(this.inside, [-1.1, y, 0], [-0.2, 0, 0]);
      return { mesh, label, link };
    });
    this.sumShape = this.shape(this.inside, sphere, '#bba7dc', [0, 0, 0]);
    this.biasShape = this.shape(this.inside, box, '#ce9d73', [0, -1.0, 0]);
    this.activationShape = this.shape(this.inside, torus, '#d5e48b', [1.25, 0, 0]);
    this.outputShape = this.shape(this.inside, sphere, '#d5e48b', [2.5, 0, 0]);
    this.line(this.inside, [0, -0.85, 0], [0, -0.2, 0]);
    this.line(this.inside, [0.2, 0, 0], [1.05, 0, 0]); this.line(this.inside, [1.48, 0, 0], [2.3, 0, 0]);
    this.sumLabel = this.label(); this.sumLabel.sprite.position.set(0, 0.5, 0.15);
    this.biasLabel = this.label(); this.biasLabel.sprite.position.set(0, -1.38, 0.15);
    this.activationLabel = this.label(); this.activationLabel.sprite.position.set(1.25, 0.5, 0.15);
    this.outputLabel = this.label(); this.outputLabel.sprite.position.set(2.5, 0.5, 0.15);
    this.insideTitle = this.label(3.0, 1.3); this.insideTitle.sprite.position.set(0.2, 1.8, 0.1);
    this.insideClose = this.label(0.7, 0.4); this.insideClose.sprite.position.set(2.6, 1.5, 0.1);
    this.insideClose.sprite.userData.action = 'close-inside'; this.text(this.insideClose, 'Cerrar ×');
    for (const label of [this.sumLabel, this.biasLabel, this.activationLabel, this.outputLabel, this.insideTitle, this.insideClose]) this.inside.add(label.sprite);
  }
  buildComparison() {
    this.comparison.position.set(4.4, 0, 0);
    const sphere = this.keep(new THREE.SphereGeometry(0.15, 20, 14));
    this.linearNodes = [[-0.9, 0.55, 0], [-0.9, -0.55, 0], [0.9, 0, 0]].map((point, index) => {
      const mesh = this.shape(this.comparison, sphere, index === 2 ? '#d2df78' : '#3297ad', point);
      const label = this.label(1.0, 0.42); label.sprite.position.set(point[0], point[1] - 0.35, 0.15);
      this.comparison.add(label.sprite); return { mesh, label };
    });
    this.linearEdges = [this.line(this.comparison, [-0.74, 0.55, 0], [0.74, 0, 0]),
      this.line(this.comparison, [-0.74, -0.55, 0], [0.74, 0, 0])];
    this.linearTitle = this.label(3.2, 1.4); this.linearTitle.sprite.position.set(0, 1.9, 0);
    this.comparison.add(this.linearTitle.sprite);
    this.linearSummary = this.label(3.2, 1.3); this.linearSummary.sprite.position.set(0, -1.6, 0);
    this.comparison.add(this.linearSummary.sprite);
    this.mlpTitle = this.label(3.2, 1.4); this.mlpTitle.sprite.position.set(0, 1.9, 0); this.root.add(this.mlpTitle.sprite); this.mlpTitle.sprite.visible = false;
  }
  buildMaps() {
    this.mapPlanes = [0, 1].map(index => {
      const canvas = this.canvasFactory(); canvas.width = 640; canvas.height = 720;
      const texture = this.keep(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      const mesh = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(2.6, 2.925)),
        this.keep(new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false })));
      mesh.position.set(index ? 4.4 : 0, -2.9, -0.15); this.maps.add(mesh);
      return { mesh, canvas, texture };
    });
  }
  update({ inside, compare, map, point, explanation, selectionTitle, linear, sample, rows, grid, signalStep = null }) {
    this.inside.visible = Boolean(inside && explanation?.terms.length);
    this.comparison.visible = Boolean(compare); this.maps.visible = Boolean(map);
    this.mlpTitle.sprite.visible = Boolean(compare);
    this.mapPlanes[1].mesh.visible = Boolean(compare);
    if (this.inside.visible) {
      const mixStep = explanation.functionName === 'tanh' ? 1 : 3;
      const activationStep = explanation.functionName === 'tanh' ? 2 : 4;
      this.inside.position.copy(point).add(new THREE.Vector3(-0.3, 2.0, 0.2));
      this.text(this.insideTitle, `${selectionTitle}\nEntradas · suma · transformación`);
      this.terms.forEach((term, index) => {
        const data = explanation.terms[index];
        term.mesh.visible = term.label.sprite.visible = term.link.visible = Boolean(data);
        if (!data) return;
        const y = explanation.terms.length === 2 ? 0.55 - index * 1.1 : 1.08 - index * 0.72;
        term.mesh.position.y = y; term.label.sprite.position.y = y;
        const positions = term.link.geometry.attributes.position; positions.setY(0, y); positions.needsUpdate = true;
        term.link.geometry.computeBoundingSphere();
        this.text(term.label, data.enabled
          ? `${format(data.input)} × ${format(data.weight)}\nAporte: ${format(data.product)}`
          : `Conexión cortada\nAporte: 0.000`);
        term.mesh.material.emissiveIntensity = signalStep === mixStep ? 1 : 0.12;
      });
      this.text(this.sumLabel, `Suma z\n${format(explanation.sum)}`);
      this.text(this.biasLabel, `Sesgo aplicado\n${format(explanation.effectiveBias)}`);
      this.text(this.activationLabel, `${explanation.functionName}\nTransformación`);
      this.text(this.outputLabel, `Respuesta\n${format(explanation.activation)}`);
      this.sumShape.material.emissiveIntensity = signalStep === mixStep ? 0.8 : 0.12;
      this.activationShape.material.emissiveIntensity = signalStep === activationStep ? 0.8 : 0.12;
    }
    if (compare) {
      const prediction = linear.evaluate(sample.x1, sample.x2).output;
      const correct = rows.filter(row => (linear.evaluate(row.x1, row.x2).output >= 0.5 ? 1 : 0) === row.target).length;
      this.text(this.linearTitle, `Sin capa oculta\n2 entradas · 1 salida\n${correct}/4 ejemplos · ${linear.epoch} rondas`);
      this.text(this.mlpTitle, `Con capa oculta\n2 entradas · 4 intermedias · 1 salida\n${rows.filter(row => row.correct).length}/4 ejemplos`);
      this.text(this.linearNodes[0].label, `x₁: ${sample.x1}`); this.text(this.linearNodes[1].label, `x₂: ${sample.x2}`);
      this.text(this.linearNodes[2].label, `ŷ: ${format(prediction)}`);
      this.text(this.linearSummary, `${correct}/4 ejemplos correctos\n${linear.epoch} rondas · BCE ${linear.loss.toFixed(4)}`);
      this.linearSummary.sprite.visible = !map;
      this.linearEdges.forEach((edge, index) => edge.material.color.set(linear.weights[index] < 0 ? '#d28d59' : '#53bbb6'));
    }
    if (map && grid && this.mapRevision !== grid.revision) {
      this.mapRevision = grid.revision;
      this.paintMap(this.mapPlanes[0], grid, 'mlp', 'Con capa oculta', rows);
      this.paintMap(this.mapPlanes[1], grid, 'linear', 'Sin capa oculta', rows);
    }
  }
  paintMap(plane, grid, key, title, rows) {
    const ctx = plane.canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#0b2930'; ctx.fillRect(0, 0, 640, 720);
    ctx.fillStyle = '#e9f6df'; ctx.font = '500 30px system-ui'; ctx.textAlign = 'center'; ctx.fillText(title, 320, 42);
    const left = 64, top = 86, width = 512, cell = width / grid.size;
    const color = new THREE.Color();
    for (let y = 0; y < grid.size; y++) for (let x = 0; x < grid.size; x++) {
      color.copy(BLUE).lerp(LIME, grid[key][y * grid.size + x]);
      ctx.fillStyle = `#${color.getHexString()}`; ctx.fillRect(left + x * cell, top + y * cell, Math.ceil(cell), Math.ceil(cell));
    }
    for (const row of rows) {
      const x = left + 12 + row.x1 * (width - 24), y = top + 12 + (1 - row.x2) * (width - 24);
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = row.target ? '#f6ffdf' : '#09242b'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.fillStyle = '#d7e9d7'; ctx.font = '27px system-ui'; ctx.fillText('Interruptor 1: 0 … 1', 320, 639);
    ctx.font = '23px system-ui'; ctx.fillText('Azul: apagada · lima: encendida', 320, 677);
    ctx.fillText('Puntos: los cuatro ejemplos XOR', 320, 708);
    ctx.save(); ctx.translate(28, 345); ctx.rotate(-Math.PI / 2); ctx.font = '25px system-ui'; ctx.fillText('Interruptor 2: 0 … 1', 0, 0); ctx.restore();
    plane.texture.needsUpdate = true;
  }
  faceCamera(camera) {
    if (!this.maps.visible) return;
    this.maps.getWorldQuaternion(this.parentRotation).invert(); camera.getWorldQuaternion(this.cameraRotation);
    for (const plane of this.mapPlanes) plane.mesh.quaternion.copy(this.parentRotation).multiply(this.cameraRotation);
  }
  hitTest(raycaster) {
    if (!this.inside.visible) return null;
    for (let parent = this.inside; parent; parent = parent.parent) if (!parent.visible) return null;
    return raycaster.intersectObject(this.insideClose.sprite, false).length ? 'close-inside' : null;
  }
  close() { this.inside.visible = false; }
  dispose() { this.root.removeFromParent(); for (const resource of this.resources) resource.dispose(); this.resources.clear(); }
}
