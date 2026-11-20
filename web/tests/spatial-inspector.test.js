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
  card.setData({ title: 'Neurona oculta h₁', editable: true });
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
    assert.deepEqual(hitAt(240, 830), { action: 'decrease' });
    assert.deepEqual(hitAt(730, 830), { action: 'increase' });
    assert.deepEqual(hitAt(920, 80), { action: 'close' });
    assert.deepEqual(hitAt(200, 400), { action: 'body' });
    assert.deepEqual(hitAt(740, 260), { action: 'concept' });
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
