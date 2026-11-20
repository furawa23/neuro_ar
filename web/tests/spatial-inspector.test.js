import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three';
import { SpatialInspector } from '../src/spatial-inspector.js';

function fixture() {
  // Painting is checked in the browser. These tests use real Three geometry,
  // world transforms and ray intersections without needing a WebGL context.
  const card = new SpatialInspector({ canvas: { getContext: () => null } });
  const anchor = new Group();
  const content = new Group();
  anchor.add(content); content.add(card.root);
  const camera = new PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0.2, 0.1, 6);
  camera.lookAt(0, 0, 0);
  card.setData({ title: 'Neurona oculta h₁', editable: true, canOpen: true, canToggle: true });
  card.openAt(new Vector3(0, 0.85, 0), true);
  const update = () => { anchor.updateMatrixWorld(true); camera.updateMatrixWorld(true); card.faceCamera(camera); };
  const hitAt = (x, y) => {
    update();
    const point = card.panel.localToWorld(new Vector3((x / 1000 - 0.5) * 2.65, (0.5 - y / 1000) * 2.65, 0));
    const origin = camera.getWorldPosition(new Vector3());
    return card.hitTest(new Raycaster(origin, point.sub(origin).normalize()));
  };
  return { card, anchor, content, camera, update, hitAt };
}

test('raycasting the 3D card activates the visible controls and blocks picking through its body', () => {
  const { card, hitAt } = fixture();
  try {
    assert.equal(card.tab, 'concept');
    assert.deepEqual(hitAt(730, 800), { action: 'body' }, 'math controls start hidden behind the explanation');
    assert.deepEqual(hitAt(500, 260), { action: 'values' });
    card.activate('values');
    assert.deepEqual(hitAt(240, 830), { action: 'decrease' });
    assert.deepEqual(hitAt(730, 830), { action: 'increase' });
    assert.deepEqual(hitAt(920, 80), { action: 'close' });
    assert.deepEqual(hitAt(200, 400), { action: 'body' });
    assert.deepEqual(hitAt(180, 260), { action: 'concept' });
    assert.deepEqual(hitAt(740, 260), { action: 'code' });
    assert.deepEqual(hitAt(200, 920), { action: 'open-neuron' });
    assert.deepEqual(hitAt(740, 920), { action: 'toggle-connection' });
    card.activate('concept');
    assert.deepEqual(hitAt(730, 830), { action: 'body' }, 'hidden parameter controls must not remain clickable');
    card.activate('values');
    card.setData({ editable: false });
    assert.deepEqual(hitAt(240, 830), { action: 'body' }, 'input neurons have no editable bias');
    card.activate('close');
    assert.equal(hitAt(740, 260), null);
  } finally { card.dispose(); }
});

test('a card stays attached to a rotated, scaled world anchor while only its reading direction follows the camera', () => {
  const { card, anchor, content, camera, update, hitAt } = fixture();
  try {
    card.activate('values');
    anchor.position.set(1, 0.4, -1);
    anchor.rotation.y = 1.1;
    content.scale.setScalar(0.2);
    update();
    const position = card.panel.getWorldPosition(new Vector3()).clone();
    const anchorRotation = anchor.quaternion.clone();
    const equalReadingDirection = () => assert.ok(1 - Math.abs(card.panel.getWorldQuaternion(new Quaternion())
      .dot(camera.getWorldQuaternion(new Quaternion()))) < 1e-10);
    equalReadingDirection();
    camera.position.set(-1, 1.5, 3);
    camera.lookAt(position);
    update();
    assert.ok(card.panel.getWorldPosition(new Vector3()).distanceTo(position) < 1e-12);
    assert.ok(1 - Math.abs(anchor.quaternion.dot(anchorRotation)) < 1e-12);
    equalReadingDirection();
    assert.deepEqual(hitAt(730, 830), { action: 'increase' });
    anchor.visible = false;
    assert.equal(hitAt(730, 830), null, 'a hidden tracking anchor cannot receive card touches');
  } finally { card.dispose(); }
});

test('closing and disposing release card resources and remove it from the scene', () => {
  const { card, content } = fixture();
  const released = [];
  for (const [name, resource] of [['texture', card.texture], ['geometry', card.panel.geometry],
    ['material', card.panel.material], ['lineGeometry', card.line.geometry], ['lineMaterial', card.line.material]]) {
    resource.addEventListener('dispose', () => released.push(name));
  }
  card.close();
  assert.equal(card.root.visible, false);
  card.dispose();
  assert.deepEqual(released, ['texture', 'geometry', 'material', 'lineGeometry', 'lineMaterial']);
  assert.equal(content.children.length, 0);
});

test('edge neurons keep an anchored reading card toward the middle while the tether starts at the actual neuron', () => {
  const { card } = fixture();
  try {
    for (const x of [-1.65, 1.65]) {
      card.openAt(new Vector3(x, 0.5, 0), true);
      assert.ok(Math.abs(card.panel.position.x) <= 0.3);
      const points = card.line.geometry.attributes.position;
      assert.ok(Math.abs(points.getX(0) - x) < 1e-6);
      assert.equal(points.getY(0), 0.5);
    }
  } finally { card.dispose(); }
});

test('initial reading size is chosen in world space and is not tied to later camera movement', () => {
  const { card, camera, anchor, update } = fixture();
  try {
    anchor.scale.setScalar(0.2); update(); card.fitForReading(camera);
    const scale = card.panel.scale.clone(), position = card.panel.getWorldPosition(new Vector3());
    assert.ok(scale.x > 1 && scale.x <= 3.5);
    camera.position.x = 1; update();
    assert.ok(card.panel.scale.equals(scale));
    assert.ok(card.panel.getWorldPosition(new Vector3()).distanceTo(position) < 1e-12);
  } finally { card.dispose(); }
});

test('reading cards fit below the top controls and above the footer in landscape', () => {
  const { card, anchor } = fixture();
  try {
    anchor.scale.setScalar(0.2); anchor.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(52, 852 / 393, 0.01, 30); camera.position.set(0, 0.1, 2.2); camera.updateMatrixWorld(true);
    card.fitForReading(camera);
    for (const x of [-1.325, 1.325]) for (const y of [-1.325, 1.325]) {
      const point = card.panel.localToWorld(new Vector3(x, y, 0)).project(camera);
      assert.ok(point.x >= -0.941 && point.x <= 0.941);
      assert.ok(point.y >= -0.661 && point.y <= 0.761);
    }
  } finally { card.dispose(); }
});

test('opening a visible neuron from close above cannot put its reading card behind the camera', () => {
  const { card, anchor } = fixture();
  try {
    anchor.position.y = 0.25; anchor.scale.setScalar(0.2); anchor.updateMatrixWorld(true);
    const point = new Vector3(0, 0.85, -0.15), world = anchor.localToWorld(point.clone());
    const camera = new PerspectiveCamera(52, 393 / 852, 0.01, 30);
    camera.position.set(0, 0.65, 0.1); camera.lookAt(world); camera.updateMatrixWorld(true);
    assert.ok(Math.abs(world.clone().project(camera).x) < 1e-8);
    const fixedAnchor = anchor.matrixWorld.clone();
    card.openAt(point, true); card.fitForReading(camera);
    assert.ok(card.panel.getWorldPosition(new Vector3()).applyMatrix4(camera.matrixWorldInverse).z < 0);
    for (const x of [-1.325, 1.325]) for (const y of [-1.325, 1.325]) {
      const projected = card.panel.localToWorld(new Vector3(x, y, 0)).project(camera);
      assert.ok(projected.x >= -0.941 && projected.x <= 0.941);
      assert.ok(projected.y >= -0.661 && projected.y <= 0.761);
      assert.ok(projected.z > -1 && projected.z < 1);
    }
    assert.ok(anchor.matrixWorld.equals(fixedAnchor));
  } finally { card.dispose(); }
});
