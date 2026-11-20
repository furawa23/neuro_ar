import * as THREE from 'three';

const SIZE = 1000;
const REGIONS = {
  close: [840, 22, 138, 132],
  concept: [44, 225, 288, 104],
  values: [356, 225, 288, 104],
  code: [668, 225, 288, 104],
  decrease: [44, 742, 430, 110],
  increase: [526, 742, 430, 110],
  'open-neuron': [44, 880, 444, 76],
  'toggle-connection': [512, 880, 444, 76],
};
const number = value => Number.isFinite(value) ? value.toFixed(3) : '—';

/** A real WebGL plane, attached to the network's world anchor, not a DOM panel. */
export class SpatialInspector {
  constructor({ canvas = document.createElement('canvas') } = {}) {
    this.canvas = canvas;
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.context = canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 2.65),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true,
        side: THREE.DoubleSide, toneMapped: false }));
    this.root.add(this.panel);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xc9edac, transparent: true, opacity: 0.85, toneMapped: false }));
    this.root.add(this.line);
    this.localRotation = new THREE.Quaternion();
    this.cameraRotation = new THREE.Quaternion();
    this.data = null;
    this.defaultTab = 'concept';
    this.tab = this.defaultTab;
    this.signature = '';
    this.leftEdge = new THREE.Vector3(); this.rightEdge = new THREE.Vector3();
    this.topEdge = new THREE.Vector3(); this.bottomEdge = new THREE.Vector3(); this.centerPoint = new THREE.Vector3();
    this.targetPoint = new THREE.Vector3(); this.rootScale = new THREE.Vector3();
  }

  setData(data) {
    this.data = { ...data };
    if (this.root.visible) this.paint();
  }

  openAt(point, arMode) {
    this.tab = this.defaultTab;
    this.panel.scale.setScalar(1);
    if (arMode) this.panel.position.set(THREE.MathUtils.clamp(point.x, -0.3, 0.3), point.y + 1.6, point.z + 0.15);
    else this.panel.position.set(point.x < -0.5 ? -0.1 : point.x > 0.5 ? 0.1 : 0.85, 0.15, 0.6);
    const positions = this.line.geometry.attributes.position;
    positions.setXYZ(0, point.x, point.y, point.z);
    positions.setXYZ(1, this.panel.position.x, this.panel.position.y, this.panel.position.z);
    positions.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.root.visible = true;
    this.paint();
  }

  close() { this.root.visible = false; }

  fitForReading(camera) {
    // Choose a readable size once, at opening. Afterwards its scale and world
    // location remain fixed as the reader walks; only the reading direction turns.
    this.faceCamera(camera);
    this.root.getWorldScale(this.rootScale);
    const comfortableDepth = Math.max(0.05, Math.max(this.rootScale.x, this.rootScale.y, this.rootScale.z) * 0.8);
    this.panel.getWorldPosition(this.centerPoint).applyMatrix4(camera.matrixWorldInverse);
    if (this.centerPoint.z >= -comfortableDepth) {
      this.targetPoint.fromBufferAttribute(this.line.geometry.attributes.position, 0)
        .applyMatrix4(this.root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this.centerPoint.z = -Math.max(comfortableDepth, -this.targetPoint.z);
      this.centerPoint.applyMatrix4(camera.matrixWorld); this.root.worldToLocal(this.centerPoint);
      this.panel.position.copy(this.centerPoint); this.panel.updateMatrixWorld(true);
    }
    this.leftEdge.set(-1.325, 0, 0).applyMatrix4(this.panel.matrixWorld).project(camera);
    this.rightEdge.set(1.325, 0, 0).applyMatrix4(this.panel.matrixWorld).project(camera);
    this.topEdge.set(0, 1.325, 0).applyMatrix4(this.panel.matrixWorld).project(camera);
    this.bottomEdge.set(0, -1.325, 0).applyMatrix4(this.panel.matrixWorld).project(camera);
    const width = Math.abs(this.rightEdge.x - this.leftEdge.x);
    const height = Math.abs(this.topEdge.y - this.bottomEdge.y);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 1e-5 && height > 1e-5) {
      const scale = THREE.MathUtils.clamp(Math.min(1.7 / width, 1.35 / height), 0.05, 3.5);
      this.panel.scale.setScalar(scale);
      this.panel.getWorldPosition(this.centerPoint).project(camera);
      const halfWidth = width * scale / 2, halfHeight = height * scale / 2;
      this.centerPoint.x = THREE.MathUtils.clamp(this.centerPoint.x, -0.94 + halfWidth, 0.94 - halfWidth);
      this.centerPoint.y = THREE.MathUtils.clamp(this.centerPoint.y, -0.66 + halfHeight, 0.76 - halfHeight);
      this.centerPoint.unproject(camera); this.root.worldToLocal(this.centerPoint);
      this.panel.position.copy(this.centerPoint);
      this.panel.updateMatrixWorld(true);
      const positions = this.line.geometry.attributes.position;
      positions.setXYZ(1, this.panel.position.x, this.panel.position.y, this.panel.position.z);
      positions.needsUpdate = true; this.line.geometry.computeBoundingSphere();
    }
  }

  faceCamera(camera) {
    if (!this.root.visible) return;
    // The card can face the reader without rotating or moving the world anchor.
    this.root.getWorldQuaternion(this.localRotation).invert();
    camera.getWorldQuaternion(this.cameraRotation);
    this.panel.quaternion.copy(this.localRotation).multiply(this.cameraRotation);
    this.panel.updateMatrixWorld(true);
  }

  hitTest(raycaster) {
    if (!this.root.visible) return null;
    for (let parent = this.root.parent; parent; parent = parent.parent) if (!parent.visible) return null;
    const hit = raycaster.intersectObject(this.panel, false)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * SIZE;
    const y = (1 - hit.uv.y) * SIZE;
    for (const [action, [left, top, width, height]] of Object.entries(REGIONS)) {
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        if ((action === 'increase' || action === 'decrease') && (this.tab !== 'values' || !this.data?.editable)) break;
        if (action === 'open-neuron' && !this.data?.canOpen) break;
        if (action === 'toggle-connection' && !this.data?.canToggle) break;
        return { action };
      }
    }
    return { action: 'body' }; // An opaque card must block picking through it.
  }

  activate(action) {
    if (action === 'close') this.close();
    if (['values', 'concept', 'code'].includes(action)) { this.tab = action; this.paint(); }
  }

  paint() {
    if (!this.data || !this.context) return;
    const signature = JSON.stringify([this.tab, this.data]);
    if (signature === this.signature) return;
    this.signature = signature;
    const ctx = this.context;
    const data = this.data;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const box = (x, y, width, height, color, radius = 24) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
    };
    const text = (value, x, y, size, color = '#e5f2e9', weight = 400) => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(String(value), x, y);
    };
    const lines = (value, x, y, size, width, gap, maximum = 8) => {
      ctx.font = `400 ${size}px system-ui, sans-serif`;
      const result = [];
      for (const paragraph of String(value ?? '').split('\n')) {
        let line = '';
        for (const word of paragraph.split(' ')) {
          if (line && ctx.measureText(`${line} ${word}`).width > width) { result.push(line); line = word; }
          else line += `${line ? ' ' : ''}${word}`;
        }
        result.push(line);
      }
      const visible = result.slice(0, maximum);
      if (result.length > maximum) visible[maximum - 1] = `${visible[maximum - 1].slice(0, -3)}…`;
      visible.forEach((line, i) => text(line, x, y + i * gap, size));
      return visible.length * gap;
    };
    box(3, 3, 994, 994, '#102f31');
    ctx.strokeStyle = '#87b8a6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(3, 3, 994, 994, 24); ctx.stroke();
    text('NEUROAR · EN VIVO', 48, 62, 27, '#b9dcab', 600);
    box(...REGIONS.close, '#244a49');
    text('×', 883, 110, 65);
    let titleSize = 52;
    do { ctx.font = `600 ${titleSize}px system-ui, sans-serif`; if (ctx.measureText(data.title).width <= 885) break; titleSize -= 2; } while (titleSize > 32);
    text(data.title, 48, 162, titleSize, '#f1f8ee', 600);
    text(data.kind, 48, 204, 29, '#aac9bf');
    for (const [key, title] of [['concept', 'Qué hace'], ['values', 'Valores'], ['code', 'Código']]) {
      box(...REGIONS[key], this.tab === key ? '#d7e8c0' : '#244a49');
      text(title, REGIONS[key][0] + 45, 292, 42, this.tab === key ? '#173c32' : '#e5f2e9', 600);
    }
    if (this.tab === 'values') {
      box(44, 340, 912, 146, '#214b43');
      text(data.resultLabel, 76, 389, 29, '#bdd4af', 600);
      text(number(data.result), 76, 459, 65, '#f1ffdc', 600);
      box(44, 505, 912, 155, '#0b2528');
      lines(data.formula, 68, 546, 30, 865, 44, 3);
      text(data.editable ? data.parameterLabel : 'Entrada del ejemplo seleccionado', 48, 705, 31, '#bad5c5', 500);
      if (data.editable) {
        ctx.textAlign = 'right';
        text(number(data.parameterValue), 948, 705, 39, '#f1ffdc', 600);
        ctx.textAlign = 'left';
        box(...REGIONS.decrease, '#315b52'); box(...REGIONS.increase, '#d7e8c0');
        text('− 0.1', 180, 815, 43, '#f1f8ee', 600);
        text('+ 0.1', 660, 815, 43, '#173c32', 600);
      } else {
        text('Cambia las entradas desde Controles.', 48, 795, 36, '#e5f2e9');
      }
    } else if (this.tab === 'code') {
      text('Pseudocódigo equivalente', 52, 380, 33, '#bdd4af', 600);
      box(44, 410, 912, 428, '#0b2528');
      lines(data.code ?? 'Selecciona un elemento de la red.', 68, 463, 34, 858, 50, 7);
    } else {
      lines(data.lesson, 52, 387, 48, 888, 60, 5);
      text('PRUEBA ESTO', 52, 718, 28, '#bdd4af', 600);
      lines(data.hint, 52, 765, 40, 888, 48, 2);
    }
    for (const [action, title, enabled] of [
      ['open-neuron', 'Ver por dentro', data.canOpen],
      ['toggle-connection', data.blockedConnection ? 'Neurona cortada' : data.connected === false ? 'Reconectar' : 'Desconectar', data.canToggle],
    ]) {
      box(...REGIONS[action], enabled ? '#315b52' : '#173e3e');
      text(title, REGIONS[action][0] + 45, 929, 32, enabled ? '#eef8e5' : '#7f9b94', 500);
    }
    text('Valores reales del experimento · detalles a tu ritmo', 48, 985, 23, '#aac9bf');
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.texture.dispose();
    this.panel.geometry.dispose(); this.panel.material.dispose();
    this.line.geometry.dispose(); this.line.material.dispose();
  }
}
