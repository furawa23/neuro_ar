import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3, PerspectiveCamera, Raycaster } from 'three';
import { SpatialLearning } from '../src/spatial-learning.js';
import { LearningLab, explainSelection } from '../src/core/learning-lab.js';

const canvasFactory = () => ({ getContext: () => null });
function data(lab, selection = { kind: 'neuron', layer: 1, index: 0 }) {
  return { inside: true, compare: true, map: true, point: new Vector3(0, 0.85, 0),
    explanation: explainSelection(lab.network, lab.network.evaluate(1, 0), selection),
    selectionTitle: 'Neurona', linear: lab.linear, sample: { x1: 1, x2: 0 }, rows: lab.results,
    grid: lab.decisionGrid(8), signalStep: 1 };
}

test('the opened neuron shows the current real products, sum, bias and response', () => {
  const learning = new SpatialLearning({ canvasFactory }), lab = new LearningLab();
  try {
    const input = data(lab); learning.update(input);
    assert.equal(learning.inside.visible, true);
    assert.equal(learning.terms[2].mesh.visible, false, 'a hidden neuron has two inputs');
    assert.match(learning.sumLabel.text, new RegExp(input.explanation.sum.toFixed(3)));
    assert.match(learning.terms[0].label.text, new RegExp(input.explanation.terms[0].product.toFixed(3)));
    const output = data(lab, { kind: 'neuron', layer: 2, index: 0 }); learning.update(output);
    assert.equal(learning.terms[3].mesh.visible, true, 'the output has four actual contributions');
    lab.toggle({ kind: 'connection', layer: 2, target: 0, source: 0 });
    learning.update(data(lab, { kind: 'neuron', layer: 2, index: 0 }));
    assert.match(learning.terms[0].label.text, /Conexión cortada\nAporte: 0.000/);
    assert.match(learning.linearSummary.text, /ejemplos correctos/);
  } finally { learning.dispose(); }
});

test('the learning objects share the anchor and hidden parents cannot receive close taps', () => {
  const learning = new SpatialLearning({ canvasFactory }), lab = new LearningLab();
  const anchor = new Group(); anchor.rotation.y = 0.6; anchor.scale.setScalar(0.2); anchor.add(learning.root);
  learning.update(data(lab)); anchor.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(50, 1, 0.01, 30); camera.position.set(0, 1.2, 4);
  const target = learning.insideClose.sprite.getWorldPosition(new Vector3()); camera.lookAt(target); camera.updateMatrixWorld(true);
  const ray = new Raycaster(camera.position, target.clone().sub(camera.position).normalize()); ray.camera = camera;
  assert.equal(learning.hitTest(ray), 'close-inside');
  const before = learning.inside.position.clone(); camera.position.x = 0.8; camera.updateMatrixWorld(true); learning.faceCamera(camera);
  assert.ok(learning.inside.position.equals(before));
  anchor.visible = false; assert.equal(learning.hitTest(ray), null);
  learning.dispose();
});

test('maps use a revision cache and resources are released exactly once', () => {
  let fills = 0;
  const ctx = { fillRect() { fills++; }, clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {},
    arc() {}, stroke() {}, save() {}, translate() {}, rotate() {}, restore() {} };
  const learning = new SpatialLearning({ canvasFactory: () => ({ getContext: () => ctx }) });
  const lab = new LearningLab(); learning.update(data(lab)); const first = fills;
  learning.update(data(lab)); assert.equal(fills, first, 'same model revision does not repaint maps');
  lab.edit({ kind: 'neuron', layer: 1, index: 0 }, 0.3); learning.update(data(lab)); assert.ok(fills > first);
  const resources = [...learning.resources], released = new Set();
  for (const resource of resources) resource.addEventListener('dispose', () => { assert.equal(released.has(resource), false); released.add(resource); });
  learning.dispose(); assert.equal(released.size, resources.length);
});
