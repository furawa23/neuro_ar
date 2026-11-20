import * as THREE from 'three';

const SIZE = 1000;
const REGIONS = {
  close: [840, 22, 138, 132],
  values: [44, 225, 444, 88],
  concept: [512, 225, 444, 88],
  decrease: [44, 778, 430, 110],
  increase: [526, 778, 430, 110],
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
    this.tab = 'values';
    this.signature = '';
  }

  setData(data) {
    this.data = { ...data };
    if (this.root.visible) this.paint();
  }

  openAt(point, arMode) {
    this.tab = 'values';
    if (arMode) this.panel.position.copy(point).add(new THREE.Vector3(0, 1.6, 0.15));
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
        return { action };
      }
    }
    return { action: 'body' }; // An opaque card must block picking through it.
  }

  activate(action) {
    if (action === 'close') this.close();
    if (action === 'values' || action === 'concept') { this.tab = action; this.paint(); }
  }

  paint() {
    if (!this.data || !this.context) return;
    const signature = JSON.stringify([this.tab, this.tab === 'values' ? this.data
      : [this.data.title, this.data.kind, this.data.lesson, this.data.hint]]);
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
    const lines = (value, x, y, size, width, gap) => {
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
      result.forEach((line, i) => text(line, x, y + i * gap, size));
      return result.length * gap;
    };
    box(3, 3, 994, 994, '#102f31');
    ctx.strokeStyle = '#87b8a6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(3, 3, 994, 994, 24); ctx.stroke();
    text('NEUROAR · EN VIVO', 48, 62, 27, '#b9dcab', 600);
    box(...REGIONS.close, '#244a49');
    text('×', 883, 110, 65);
    let titleSize = 48;
    do { ctx.font = `600 ${titleSize}px system-ui, sans-serif`; if (ctx.measureText(data.title).width <= 885) break; titleSize -= 2; } while (titleSize > 32);
    text(data.title, 48, 162, titleSize, '#f1f8ee', 600);
    text(data.kind, 48, 204, 29, '#aac9bf');
    for (const [key, title] of [['values', 'Valores'], ['concept', 'Concepto']]) {
      box(...REGIONS[key], this.tab === key ? '#d7e8c0' : '#244a49');
      text(title, REGIONS[key][0] + 125, 282, 36, this.tab === key ? '#173c32' : '#e5f2e9', 600);
    }
    if (this.tab === 'values') {
      box(44, 340, 912, 146, '#214b43');
      text(data.resultLabel, 76, 389, 29, '#bdd4af', 600);
      text(number(data.result), 76, 459, 65, '#f1ffdc', 600);
      box(44, 510, 912, 184, '#0b2528');
      lines(data.formula, 68, 557, 32, 865, 47);
      text(data.editable ? data.parameterLabel : 'Entrada del ejemplo seleccionado', 48, 745, 32, '#bad5c5', 500);
      if (data.editable) {
        ctx.textAlign = 'right';
        text(number(data.parameterValue), 948, 745, 39, '#f1ffdc', 600);
        ctx.textAlign = 'left';
        box(...REGIONS.decrease, '#315b52'); box(...REGIONS.increase, '#d7e8c0');
        text('− 0.1', 180, 850, 43, '#f1f8ee', 600);
        text('+ 0.1', 660, 850, 43, '#173c32', 600);
      } else {
        text('Cambia las entradas desde Controles.', 48, 833, 36, '#e5f2e9');
      }
      text('Parámetros y activación se actualizan al entrenar.', 48, 954, 27, '#aac9bf');
    } else {
      const height = lines(data.lesson, 52, 387, 42, 888, 62);
      lines(data.hint, 52, Math.max(690, 430 + height), 32, 888, 48);
      text('Toca Valores para volver a las matemáticas.', 48, 954, 28, '#aac9bf');
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.texture.dispose();
    this.panel.geometry.dispose(); this.panel.material.dispose();
    this.line.geometry.dispose(); this.line.material.dispose();
  }
}
