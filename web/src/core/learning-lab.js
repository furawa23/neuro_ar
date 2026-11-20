import { TinyNetwork, TrainingSession, validatedSamples } from './network.js';

const clone = value => JSON.parse(JSON.stringify(value));
const sigmoid = value => { const exp = Math.exp(value < 0 ? value : -value); return value >= 0 ? 1 / (1 + exp) : exp / (1 + exp); };
const finite = value => { if (!Number.isFinite(value)) throw new RangeError('Expected a finite number.'); return value; };

/** Actual logistic regression, with the same two inputs and training examples. */
export class LinearNetwork {
  constructor(samples = TinyNetwork.samples) {
    this.samples = validatedSamples(samples);
    const seed = new TinyNetwork();
    this.weights = [seed.getWeight(1, 0, 0), seed.getWeight(1, 0, 1)];
    this.bias = 0; this.epoch = 0; this.learningRate = 0.6;
  }
  evaluate(x1, x2) {
    finite(x1); finite(x2);
    const outputSum = finite(x1 * this.weights[0] + x2 * this.weights[1] + this.bias);
    return { inputs: [x1, x2], outputSum, output: sigmoid(outputSum) };
  }
  get loss() {
    return this.samples.reduce((total, sample) => {
      const z = this.evaluate(sample.x1, sample.x2).outputSum;
      return total + Math.max(z, 0) - z * sample.target + Math.log(1 + Math.exp(-Math.abs(z)));
    }, 0) / this.samples.length;
  }
  trainEpoch() {
    finite(this.learningRate); if (this.learningRate <= 0) throw new RangeError('Positive learning rate required.');
    let g0 = 0, g1 = 0, bias = 0;
    for (const sample of this.samples) {
      const delta = (this.evaluate(sample.x1, sample.x2).output - sample.target) / this.samples.length;
      g0 += delta * sample.x1; g1 += delta * sample.x2; bias += delta;
    }
    const weights = [finite(this.weights[0] - this.learningRate * g0), finite(this.weights[1] - this.learningRate * g1)];
    const nextBias = finite(this.bias - this.learningRate * bias);
    this.weights = weights; this.bias = nextBias; this.epoch++;
  }
  capture() { return { weights: [...this.weights], bias: this.bias, epoch: this.epoch, learningRate: this.learningRate, samples: this.samples.map(sample => ({ ...sample })) }; }
  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.weights) || snapshot.weights.length !== 2) throw new TypeError('Invalid linear model.');
    const weights = snapshot.weights.map(finite), bias = finite(snapshot.bias), learningRate = finite(snapshot.learningRate);
    if (!Number.isInteger(snapshot.epoch) || snapshot.epoch < 0 || learningRate <= 0) throw new RangeError('Invalid linear state.');
    const samples = validatedSamples(snapshot.samples);
    this.weights = weights; this.bias = bias; this.epoch = snapshot.epoch; this.learningRate = learningRate; this.samples = samples;
  }
}

let trained, trainedLinear;
function trainedParameters() {
  if (!trained) {
    const network = new TinyNetwork();
    for (let i = 0; i < 3000; i++) network.trainEpoch();
    trained = network.capture();
  }
  return clone(trained);
}

function trainedLinearParameters() {
  if (!trainedLinear) {
    const network = new LinearNetwork();
    for (let i = 0; i < 3000; i++) network.trainEpoch();
    trainedLinear = network.capture();
  }
  return clone(trainedLinear);
}

export function resultsFor(network) {
  return TinyNetwork.samples.map((sample, index) => {
    const output = network.evaluate(sample.x1, sample.x2).output;
    return { ...sample, output, predicted: output >= 0.5 ? 1 : 0,
      correct: (output >= 0.5 ? 1 : 0) === sample.target,
      taught: network.samples[index].target };
  });
}

/** Pedagogical experiments share the real model and preserve exact undo states. */
export class LearningLab {
  constructor() {
    this.session = new TrainingSession(); this.linear = new LinearNetwork();
    this.linearOrigin = this.linear.capture();
    this.scenario = 'initial'; this.revision = 0; this.undoStack = [];
    this.returnState = null; this.cutState = null; this.beforeResults = null; this.repairStartLoss = null;
  }
  get network() { return this.session.network; }
  get results() { return resultsFor(this.network); }
  get correctCount() { return this.results.filter(row => row.correct).length; }
  get canUndo() { return this.undoStack.length > 0; }
  get repaired() { return this.scenario === 'repair' && this.correctCount === 4 && this.network.lossFor(TinyNetwork.samples) < this.repairStartLoss; }

  capture() {
    return clone({ session: this.session.captureCheckpoint(), linear: this.linear.capture(), linearOrigin: this.linearOrigin, scenario: this.scenario,
      returnState: this.returnState, cutState: this.cutState, beforeResults: this.beforeResults, repairStartLoss: this.repairStartLoss });
  }
  restore(state) {
    const session = new TrainingSession(); session.restoreCheckpoint(state.session);
    const linear = new LinearNetwork(); linear.restore(state.linear);
    const origin = new LinearNetwork(); origin.restore(state.linearOrigin ?? new LinearNetwork(session.network.samples).capture());
    if (!['initial', 'trained', 'repair', 'wrong-labels'].includes(state.scenario)) throw new TypeError('Invalid scenario.');
    const returnState = clone(state.returnState ?? null), cutState = clone(state.cutState ?? null);
    const beforeResults = clone(state.beforeResults ?? null);
    if (state.repairStartLoss !== null && !Number.isFinite(state.repairStartLoss)) throw new TypeError('Invalid repair loss.');
    this.session = session; this.linear = linear; this.scenario = state.scenario;
    this.linearOrigin = origin.capture();
    this.returnState = returnState; this.cutState = cutState;
    this.beforeResults = beforeResults; this.repairStartLoss = state.repairStartLoss;
    this.revision++;
  }
  saveUndo() { this.undoStack.push(this.capture()); if (this.undoStack.length > 20) this.undoStack.shift(); this.beforeResults = this.results; }
  undo() {
    if (!this.undoStack.length) return false;
    const state = this.undoStack.at(-1); this.restore(state); this.undoStack.pop(); return true;
  }
  syncComparison() {
    const key = JSON.stringify(this.network.samples);
    if (JSON.stringify(this.linear.samples) !== key || this.linear.epoch > this.network.epoch) {
      this.linear = new LinearNetwork(this.network.samples);
      if (JSON.stringify(this.linearOrigin.samples) === key && this.linearOrigin.epoch <= this.network.epoch) this.linear.restore(this.linearOrigin);
    }
    this.linear.learningRate = this.network.learningRate;
    while (this.linear.epoch < this.network.epoch) this.linear.trainEpoch();
  }
  changed() { this.syncComparison(); this.revision++; }
  step(epochs = 10, maximumEpoch = 4000) {
    const result = this.session.step(epochs, maximumEpoch);
    if (result) this.changed();
    return result;
  }
  edit(selection, value) {
    const previous = this.capture();
    if (selection.kind === 'connection') this.session.editWeight(selection.layer, selection.target, selection.source, value);
    else this.session.editBias(selection.layer, selection.index, value);
    this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift();
    this.beforeResults = resultsForSnapshot(previous.session.network);
    this.changed();
  }
  toggle(selection) {
    if (selection.kind === 'neuron' && selection.layer === 2) return false;
    if (selection.kind === 'connection' && (!this.network.isNeuronEnabled(selection.layer, selection.target)
      || !this.network.isNeuronEnabled(selection.layer - 1, selection.source))) return false;
    const previous = this.capture();
    if (!this.cutState) this.cutState = clone(previous);
    try {
      if (selection.kind === 'connection') this.session.setConnectionEnabled(selection.layer, selection.target, selection.source,
        !this.network.isConnectionEnabled(selection.layer, selection.target, selection.source));
      else this.session.setNeuronEnabled(selection.layer, selection.index, !this.network.isNeuronEnabled(selection.layer, selection.index));
    } catch (error) { this.restore(previous); throw error; }
    this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift();
    this.beforeResults = resultsForSnapshot(previous.session.network); this.changed(); return true;
  }
  restoreCuts() {
    if (!this.cutState) return false;
    const state = this.cutState; this.saveUndo(); this.restore(state); this.cutState = null; return true;
  }
  scrub(index) { this.session.scrub(index); this.changed(); }
  preset(name, { visitor = false } = {}) {
    if (!['initial', 'trained', 'repair', 'wrong-labels'].includes(name)) throw new RangeError('Unknown experiment.');
    if ((name === 'repair' || name === 'wrong-labels') && !visitor) {
      let depth = 0;
      for (let state = this.returnState; state; state = state.returnState) depth++;
      if (depth >= 8) throw new RangeError('Vuelve a una red anterior o prepara una red inicial antes de abrir otro experimento.');
    }
    const previous = this.capture();
    const target = new TrainingSession();
    if (name === 'trained' || name === 'repair') {
      const parameters = trainedParameters();
      if (name === 'repair') parameters.outputBias += 6.5;
      target.load(parameters);
    } else if (name === 'wrong-labels') {
      const samples = TinyNetwork.samples.map((sample, index) => ({ ...sample, target: index === 3 ? 1 : sample.target }));
      const parameters = trainedParameters(); parameters.samples = samples; parameters.epoch = 0;
      target.load(parameters);
    }
    this.session = target; this.linear = new LinearNetwork(target.network.samples); this.scenario = name;
    if (name === 'wrong-labels') {
      const parameters = trainedLinearParameters(); parameters.samples = target.network.samples; parameters.epoch = 0;
      this.linear.restore(parameters);
    }
    this.linearOrigin = this.linear.capture();
    this.returnState = name === 'wrong-labels' || name === 'repair' ? clone(previous) : null;
    this.cutState = null; this.beforeResults = resultsForSnapshot(previous.session.network);
    this.repairStartLoss = name === 'repair' ? target.network.lossFor(TinyNetwork.samples) : null;
    if (visitor) { this.undoStack = []; this.returnState = null; this.beforeResults = null; }
    else { this.undoStack.push(previous); if (this.undoStack.length > 20) this.undoStack.shift(); }
    this.changed();
  }
  returnToExperiment() {
    if (!this.returnState) return false;
    const state = this.returnState; this.saveUndo(); this.restore(state); return true;
  }
  repairSolution() {
    if (this.scenario !== 'repair') return false;
    this.saveUndo(); this.beforeResults = this.results;
    this.session.load(trainedParameters()); this.changed(); return true;
  }
  decisionGrid(size = 32) {
    if (!Number.isInteger(size) || size < 2 || size > 64) throw new RangeError('Invalid grid size.');
    const mlp = [], linear = [];
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const x = col / (size - 1), y = 1 - row / (size - 1);
      mlp.push(this.network.evaluate(x, y).output); linear.push(this.linear.evaluate(x, y).output);
    }
    return { size, mlp, linear, revision: this.revision };
  }
}

function resultsForSnapshot(parameters) { const network = new TinyNetwork(); network.restore(parameters); return resultsFor(network); }

export function explainSelection(network, state, selection) {
  const connection = selection.kind === 'connection';
  const layer = selection.layer, index = connection ? selection.target : selection.index;
  if (layer === 0) return { terms: [], sum: state.inputs[index], activation: state.inputs[index], bias: 0,
    functionName: 'dato', enabled: network.isNeuronEnabled(0, index),
    code: network.isNeuronEnabled(0, index) ? `x${index + 1} = ${state.inputs[index].toFixed(3)}\n# Dato del interruptor seleccionado.`
      : `interruptor = ${state.rawInputs[index].toFixed(3)}\n# Entrada desconectada.\nvalor_aplicado = 0.000` };
  const inputs = layer === 1 ? state.inputs : state.hiddenActivations;
  const terms = inputs.map((input, source) => {
    const weight = network.getWeight(layer, index, source);
    const enabled = network.isConnectionEnabled(layer, index, source);
    return { input, source, weight, enabled, product: enabled ? input * weight : 0 };
  });
  const enabled = network.isNeuronEnabled(layer, index);
  const bias = network.getBias(layer, index);
  const sum = layer === 1 ? state.hiddenSums[index] : state.outputSum;
  const activation = layer === 1 ? state.hiddenActivations[index] : state.output;
  const functionName = layer === 1 ? 'tanh' : 'sigmoide';
  return { terms, bias, effectiveBias: enabled ? bias : 0, sum, activation, functionName, enabled,
    code: connection
      ? terms[selection.source].enabled
        ? `aporte = entrada * peso\n       = ${terms[selection.source].input.toFixed(3)} * ${terms[selection.source].weight.toFixed(3)}\n       = ${terms[selection.source].product.toFixed(3)}`
        : `aporte = 0\n# Conexión desconectada.\n# Peso conservado: ${terms[selection.source].weight.toFixed(3)}`
      : !enabled ? 'respuesta = 0\n# Neurona desconectada.\n# Los parámetros se conservan.'
      : `aportes = entradas * pesos${terms.some(term => !term.enabled) ? '\naportes[conexiones_cortadas] = 0' : ''}\nz = suma(aportes) + sesgo\n  = ${sum.toFixed(3)}\nrespuesta = ${functionName}(z)\n          = ${activation.toFixed(3)}` };
}
