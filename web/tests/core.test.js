import test from 'node:test';
import assert from 'node:assert/strict';
import { TinyNetwork, TrainingSession } from '../src/core/network.js';

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function parameters(network) {
  const list = [];
  for (let h = 0; h < 4; h++) for (let i = 0; i < 2; i++) list.push({ get: () => network.getWeight(1, h, i), set: value => network.setWeight(1, h, i, value) });
  for (let h = 0; h < 4; h++) list.push({ get: () => network.getBias(1, h), set: value => network.setBias(1, h, value) });
  for (let h = 0; h < 4; h++) list.push({ get: () => network.getWeight(2, 0, h), set: value => network.setWeight(2, 0, h, value) });
  list.push({ get: () => network.getBias(2, 0), set: value => network.setBias(2, 0, value) });
  return list;
}

test('initial seed and weighted activations are deterministic', () => {
  const network = new TinyNetwork();
  const duplicate = new TinyNetwork();
  assert.deepEqual(network.capture(), duplicate.capture());
  // Independently known first two unsigned LCG states for seed 42.
  near(network.getWeight(1, 0, 0), (1083814273 / 4294967295) * 2 - 1, 1e-15);
  near(network.getWeight(1, 0, 1), (378494188 / 4294967295) * 2 - 1, 1e-15);
  const forward = network.evaluate(0.4, 0.7);
  let expectedSum = network.getBias(2, 0);
  for (let h = 0; h < 4; h++) {
    const z = 0.4 * network.getWeight(1, h, 0) + 0.7 * network.getWeight(1, h, 1) + network.getBias(1, h);
    near(forward.hiddenSums[h], z);
    near(forward.hiddenActivations[h], Math.tanh(z));
    expectedSum += network.getWeight(2, 0, h) * Math.tanh(z);
  }
  near(forward.outputSum, expectedSum);
  near(forward.output, 1 / (1 + Math.exp(-expectedSum)));
  forward.inputs[0] = 999;
  forward.hiddenActivations[0] = 999;
  assert.deepEqual(network.capture(), duplicate.capture());
});

test('all 17 backpropagation gradients match finite differences', () => {
  const network = new TinyNetwork();
  network.learningRate = 0.001;
  const entries = parameters(network);
  const before = entries.map(entry => entry.get());
  const epsilon = 1e-5;
  const numerical = entries.map(entry => {
    const initial = entry.get();
    entry.set(initial + epsilon);
    const plus = network.loss;
    entry.set(initial - epsilon);
    const minus = network.loss;
    entry.set(initial);
    return (plus - minus) / (2 * epsilon);
  });
  network.trainEpoch();
  assert.equal(network.epoch, 1);
  assert.equal(entries.length, 17);
  entries.forEach((entry, index) => near((before[index] - entry.get()) / network.learningRate, numerical[index], 1e-8));
});

test('XOR converges with the same seed, learning rate and 3000 epochs', () => {
  const network = new TinyNetwork();
  near(network.loss, 0.68881, 0.000005);
  for (let i = 0; i < 3000; i++) network.trainEpoch();
  assert.equal(network.epoch, 3000);
  near(network.loss, 0.00164, 0.000005);
  const expected = [0.00062, 0.99802, 0.99863, 0.00257];
  TinyNetwork.samples.forEach(({ x1, x2, target }, index) => {
    const output = network.evaluate(x1, x2).output;
    near(output, expected[index], 0.000005);
    assert.equal(output >= 0.5 ? 1 : 0, target);
  });
});

test('snapshots and restores are detached, exact and atomic', () => {
  const network = new TinyNetwork();
  const original = network.capture();
  const detached = network.capture();
  detached.inputWeights[0][0] = 123;
  detached.hiddenBiases[0] = 123;
  detached.outputWeights[0] = 123;
  assert.deepEqual(network.capture(), original);
  network.trainEpoch();
  network.restore(original);
  assert.deepEqual(network.capture(), original);
  original.inputWeights[0][0] = 345;
  assert.notEqual(network.getWeight(1, 0, 0), 345);
  const before = network.capture();
  const invalid = network.capture();
  invalid.inputWeights[0][0] = 98;
  invalid.outputWeights[3] = NaN;
  assert.throws(() => network.restore(invalid), RangeError);
  assert.deepEqual(network.capture(), before);
});

test('invalid dimensions, indices and nonfinite values are rejected', () => {
  const network = new TinyNetwork();
  for (const action of [
    () => network.evaluate(NaN, 0),
    () => network.evaluate(0, Infinity),
    () => network.setWeight(0, 0, 0, 1),
    () => network.setWeight(1, 4, 0, 1),
    () => network.getWeight(1, 0, 2),
    () => network.getWeight(2, 1, 0),
    () => network.getWeight(1, 0, 0.5),
    () => network.setBias(1, -1, 1),
    () => network.setWeight(2, 0, 0, -Infinity),
    () => { network.learningRate = 0; },
    () => { network.learningRate = NaN; },
    () => new TinyNetwork(1.5),
  ]) assert.throws(action, RangeError);
  assert.throws(() => network.restore(null), TypeError);
  const wrongDimensions = network.capture();
  wrongDimensions.hiddenBiases = [0, 0, 0];
  assert.throws(() => network.restore(wrongDimensions), TypeError);
  const wrongEpoch = network.capture();
  wrongEpoch.epoch = 1.5;
  assert.throws(() => network.restore(wrongEpoch), RangeError);
});

test('saturated logits keep sigmoid and BCE finite; overflow cannot partially train', () => {
  const network = new TinyNetwork();
  network.setBias(2, 0, 1000);
  assert.equal(network.evaluate(0, 0).output, 1);
  assert.ok(Number.isFinite(network.loss));
  network.setBias(2, 0, -1000);
  assert.equal(network.evaluate(0, 0).output, 0);
  assert.ok(Number.isFinite(network.loss));
  network.setWeight(1, 0, 0, Number.MAX_VALUE);
  network.setWeight(1, 0, 1, Number.MAX_VALUE);
  const before = network.capture();
  assert.throws(() => network.trainEpoch(), RangeError);
  assert.deepEqual(network.capture(), before);
});

test('scrubbing and replay restore exact states, then parameter edits create a branch', () => {
  const session = new TrainingSession();
  const initial = session.network.capture();
  const firstLoss = session.losses[0];
  assert.equal(session.historyCount, 1);
  assert.equal(session.historyIndex, 0);
  assert.equal(session.step(), true);
  const ten = session.network.capture();
  assert.equal(ten.epoch, 10);
  session.step();
  const twenty = session.network.capture();
  assert.equal(twenty.epoch, 20);
  session.scrub(0);
  assert.deepEqual(session.network.capture(), initial);
  assert.equal(session.step(200), true);
  assert.deepEqual(session.network.capture(), ten);
  assert.equal(session.historyCount, 3);
  session.scrub(2147483647);
  assert.deepEqual(session.network.capture(), twenty);
  session.scrub(-2147483648);
  assert.deepEqual(session.network.capture(), initial);
  session.scrub(1);
  assert.throws(() => session.editWeight(1, 0, 0, NaN), RangeError);
  assert.equal(session.historyCount, 3);
  session.editWeight(1, 0, 0, 1.75);
  assert.equal(session.historyCount, 2);
  assert.equal(session.losses.length, 2);
  assert.equal(session.network.getWeight(1, 0, 0), 1.75);
  assert.equal(session.losses[1], Math.fround(session.network.loss));
  const branch = session.network.capture();
  session.scrub(0);
  assert.equal(session.losses[0], firstLoss);
  session.step();
  assert.deepEqual(session.network.capture(), branch);
  session.step();
  assert.equal(session.network.epoch, 20);
  assert.equal(session.historyCount, 3);
  assert.notDeepEqual(session.network.capture(), twenty);
  session.scrub(0);
  session.editBias(1, 2, -0.75);
  assert.equal(session.historyCount, 1);
  session.scrub(0);
  assert.equal(session.network.getBias(1, 2), -0.75);
  session.reset();
  assert.equal(session.historyCount, 1);
  assert.equal(session.historyIndex, 0);
  assert.deepEqual(session.network.capture(), initial);
});

test('training cap is exact while saved states remain replayable', () => {
  const session = new TrainingSession();
  assert.equal(session.step(10, 17), true);
  assert.equal(session.network.epoch, 10);
  assert.equal(session.step(10, 17), true);
  assert.equal(session.network.epoch, 17);
  assert.equal(session.step(10, 17), false);
  assert.equal(session.historyCount, 3);
  session.scrub(0);
  assert.equal(session.step(10, 0), true);
  assert.equal(session.network.epoch, 10);
  for (const action of [() => session.step(0), () => session.step(1.5), () => session.step(10, -1), () => session.scrub(NaN)]) assert.throws(action, RangeError);
  assert.ok(Object.isFrozen(session.losses));
  assert.throws(() => { session.losses[0] = 500; }, TypeError);
  assert.notEqual(session.losses[0], 500);
});
