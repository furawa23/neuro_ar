import test from 'node:test';
import assert from 'node:assert/strict';
import { TinyNetwork, TrainingSession } from '../src/core/network.js';
import { LearningLab, LinearNetwork, explainSelection } from '../src/core/learning-lab.js';
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('training data belongs to the experiment and legacy snapshots recover the original XOR', () => {
  const samples = TinyNetwork.samples.map(sample => ({ ...sample })); samples[3].target = 1;
  const wrong = new TinyNetwork(42, { samples }); samples[0].target = 1;
  assert.equal(wrong.samples[0].target, 0);
  assert.equal(wrong.samples[3].target, 1);
  assert.equal(TinyNetwork.samples[3].target, 0);
  assert.ok(Object.isFrozen(wrong.samples[0]));
  const legacy = new TinyNetwork().capture(); delete legacy.samples; delete legacy.architecture;
  delete legacy.disabledNeurons; delete legacy.disabledConnections;
  wrong.restore(legacy);
  assert.deepEqual(wrong.samples, TinyNetwork.samples);
  const before = wrong.capture(), invalid = wrong.capture(); invalid.samples[0].target = 0.5;
  assert.throws(() => wrong.restore(invalid)); assert.deepEqual(wrong.capture(), before);
});

test('disconnection changes the forward calculation while retaining parameters during training', () => {
  const network = new TinyNetwork();
  const original = network.capture(), base = network.evaluate(1, 0);
  network.setNeuronEnabled(1, 0, false);
  const disconnected = network.evaluate(1, 0);
  assert.equal(disconnected.hiddenActivations[0], 0);
  near(disconnected.outputSum, base.outputSum - base.hiddenActivations[0] * original.outputWeights[0]);
  for (let i = 0; i < 20; i++) network.trainEpoch();
  assert.equal(network.getWeight(1, 0, 0), original.inputWeights[0][0]);
  assert.equal(network.getBias(1, 0), original.hiddenBiases[0]);
  assert.equal(network.getWeight(2, 0, 0), original.outputWeights[0]);
  network.restore(original); assert.deepEqual(network.evaluate(1, 0), base);
  network.setConnectionEnabled(1, 1, 0, false);
  const weight = network.getWeight(1, 1, 0); network.trainEpoch(); assert.equal(network.getWeight(1, 1, 0), weight);
  const before = network.capture(), bad = network.capture(); bad.disabledConnections.push('1-0-3');
  assert.throws(() => network.restore(bad)); assert.deepEqual(network.capture(), before);
});

test('gradients still match finite differences with disconnected inputs, neurons and connections', () => {
  const network = new TinyNetwork(); network.learningRate = 0.001;
  network.setNeuronEnabled(0, 0, false); network.setNeuronEnabled(1, 2, false); network.setConnectionEnabled(2, 0, 1, false);
  const entries = [];
  for (let h = 0; h < 4; h++) {
    for (let i = 0; i < 2; i++) entries.push([() => network.getWeight(1, h, i), v => network.setWeight(1, h, i, v)]);
    entries.push([() => network.getBias(1, h), v => network.setBias(1, h, v)]);
    entries.push([() => network.getWeight(2, 0, h), v => network.setWeight(2, 0, h, v)]);
  }
  entries.push([() => network.getBias(2, 0), v => network.setBias(2, 0, v)]);
  const initial = entries.map(([get]) => get());
  const gradients = entries.map(([get, set]) => {
    const original = get(), epsilon = 1e-5;
    set(original + epsilon); const plus = network.loss;
    set(original - epsilon); const minus = network.loss;
    set(original); return (plus - minus) / (2 * epsilon);
  });
  network.trainEpoch();
  entries.forEach(([get], i) => near((initial[i] - get()) / network.learningRate, gradients[i], 1e-7));
});

test('checkpoints restore the full timeline, replay cursor, data and masks atomically', () => {
  const session = new TrainingSession(); session.step(10); session.step(10); session.scrub(1);
  session.setConnectionEnabled(1, 0, 0, false); const saved = session.captureCheckpoint();
  session.step(20); session.editBias(2, 0, 2); session.restoreCheckpoint(saved);
  assert.deepEqual(session.captureCheckpoint(), saved);
  saved.history[0].inputWeights[0][0] = 999;
  assert.notEqual(session.captureCheckpoint().history[0].inputWeights[0][0], 999);
  const before = session.captureCheckpoint(), invalid = session.captureCheckpoint(); invalid.historyIndex = 999;
  assert.throws(() => session.restoreCheckpoint(invalid)); assert.deepEqual(session.captureCheckpoint(), before);
  const inconsistent = session.captureCheckpoint(); inconsistent.network.outputBias = 999;
  assert.throws(() => session.restoreCheckpoint(inconsistent)); assert.deepEqual(session.captureCheckpoint(), before);
});

test('linear baseline has real logistic-regression gradients and trains under the same examples', () => {
  const network = new LinearNetwork(); network.learningRate = 0.001;
  const before = [...network.weights, network.bias], eps = 1e-5;
  const set = (index, value) => { if (index < 2) network.weights[index] = value; else network.bias = value; };
  const gradient = before.map((value, index) => {
    set(index, value + eps); const plus = network.loss;
    set(index, value - eps); const minus = network.loss;
    set(index, value); return (plus - minus) / (2 * eps);
  });
  network.trainEpoch();
  [...network.weights, network.bias].forEach((value, index) => near((before[index] - value) / network.learningRate, gradient[index]));
  const lab = new LearningLab(); lab.step(3000);
  assert.equal(lab.linear.epoch, lab.network.epoch);
  assert.deepEqual(lab.linear.samples, lab.network.samples);
  assert.equal(lab.correctCount, 4);
  assert.ok(lab.linear.loss > 0.69); assert.ok(lab.network.loss < 0.01);
});

test('repair starts with an actual mistake and a user parameter change repairs the predictions', () => {
  const lab = new LearningLab(); lab.preset('repair');
  assert.equal(lab.correctCount, 3); assert.equal(lab.repaired, false);
  lab.edit({ kind: 'neuron', layer: 2, index: 0 }, lab.network.getBias(2, 0) - 0.6);
  assert.equal(lab.correctCount, 4); assert.equal(lab.repaired, true);
  lab.undo(); assert.equal(lab.correctCount, 3);
  lab.repairSolution(); assert.equal(lab.repaired, true);
  assert.equal(lab.network.epoch, 3000);
});

test('wrong-label experiment is isolated and return restores the whole previous experiment', () => {
  const lab = new LearningLab(); lab.step(30); lab.session.scrub(0); lab.changed();
  const before = lab.capture();
  lab.preset('wrong-labels'); assert.equal(lab.network.samples[3].target, 1);
  assert.equal(lab.correctCount, 4, 'the experiment starts from an actually learned clean rule');
  assert.equal(lab.results.filter(row => row.predicted === row.taught).length, 3);
  const linearOrigin = lab.linear.capture();
  lab.step(3000);
  assert.equal(lab.results.filter(row => row.predicted === row.taught).length, 4);
  assert.equal(lab.correctCount, 3); assert.equal(TinyNetwork.samples[3].target, 0);
  lab.scrub(0); assert.deepEqual(lab.linear.capture(), linearOrigin, 'rewinding keeps the same pretrained linear baseline');
  lab.returnToExperiment(); assert.deepEqual(lab.capture(), before);
});

test('cut restore and undo recover parameters and timeline; new visitor removes prior interventions', () => {
  const lab = new LearningLab(); lab.step(20); const original = lab.capture();
  lab.toggle({ kind: 'neuron', layer: 1, index: 0 }); lab.step(20);
  assert.equal(lab.network.isNeuronEnabled(1, 0), false);
  const cutState = lab.capture();
  assert.equal(lab.toggle({ kind: 'connection', layer: 1, target: 0, source: 0 }), false, 'a cut parent must be restored first');
  assert.deepEqual(lab.capture(), cutState);
  lab.restoreCuts(); assert.deepEqual(lab.capture(), original);
  lab.preset('repair'); lab.toggle({ kind: 'connection', layer: 1, target: 0, source: 0 });
  lab.preset('initial', { visitor: true });
  assert.equal(lab.canUndo, false); assert.equal(lab.returnState, null); assert.equal(lab.cutState, null);
  assert.equal(lab.network.epoch, 0); assert.deepEqual(lab.network.capture(), new TinyNetwork().capture());
});

test('decision map and neuron explanation agree with the evaluated model without mutating it', () => {
  const lab = new LearningLab(); lab.step(10); const before = lab.capture();
  const grid = lab.decisionGrid(8);
  for (const [row, col] of [[0, 0], [0, 7], [7, 0], [7, 7], [3, 4]]) {
    near(grid.mlp[row * 8 + col], lab.network.evaluate(col / 7, 1 - row / 7).output);
    near(grid.linear[row * 8 + col], lab.linear.evaluate(col / 7, 1 - row / 7).output);
  }
  assert.deepEqual(lab.capture(), before);
  const state = lab.network.evaluate(1, 0);
  const explanation = explainSelection(lab.network, state, { kind: 'neuron', layer: 1, index: 0 });
  near(explanation.terms.reduce((sum, term) => sum + term.product, explanation.bias), state.hiddenSums[0]);
  near(Math.tanh(explanation.sum), explanation.activation);
  lab.toggle({ kind: 'connection', layer: 1, target: 0, source: 0 });
  const cut = explainSelection(lab.network, lab.network.evaluate(1, 0), { kind: 'connection', layer: 1, target: 0, source: 0 });
  assert.equal(cut.terms[0].product, 0); assert.match(cut.code, /aporte = 0/);
  const affected = explainSelection(lab.network, lab.network.evaluate(1, 0), { kind: 'neuron', layer: 1, index: 0 });
  assert.match(affected.code, /aportes\[conexiones_cortadas\] = 0/);
  lab.toggle({ kind: 'neuron', layer: 0, index: 0 });
  const input = explainSelection(lab.network, lab.network.evaluate(1, 0), { kind: 'neuron', layer: 0, index: 0 });
  assert.match(input.code, /interruptor = 1.000/); assert.match(input.code, /valor_aplicado = 0.000/);
});

test('each sandbox returns to the immediately preceding edited experiment, including its cuts and cursor', () => {
  for (const from of ['initial', 'trained', 'repair', 'wrong-labels']) for (const to of ['repair', 'wrong-labels']) {
    const lab = new LearningLab(); lab.preset(from); lab.step(10); lab.step(10); lab.scrub(1);
    lab.edit({ kind: 'neuron', layer: 2, index: 0 }, lab.network.getBias(2, 0) - 0.2);
    lab.toggle({ kind: 'connection', layer: 1, target: 0, source: 0 });
    const before = lab.capture(); lab.preset(to); lab.returnToExperiment();
    assert.deepEqual(lab.capture(), before, `${from} to ${to}`);
  }
});

test('accepted finite high losses survive checkpoint round trips and excessive sandbox nesting is bounded', () => {
  const session = new TrainingSession(); session.editBias(2, 0, 1e40);
  assert.ok(Number.isFinite(session.losses[0]));
  const checkpoint = session.captureCheckpoint(); session.restoreCheckpoint(checkpoint);
  assert.deepEqual(session.captureCheckpoint(), checkpoint);
  const lab = new LearningLab();
  for (let i = 0; i < 8; i++) lab.preset(i % 2 ? 'repair' : 'wrong-labels');
  const before = lab.capture(); assert.throws(() => lab.preset('repair'), /Vuelve/); assert.deepEqual(lab.capture(), before);
});
