/** Deterministic, renderer-independent 2–4–1 XOR network. */
export class TinyNetwork {
  static inputCount = 2;
  static hiddenCount = 4;
  static samples = Object.freeze([
    Object.freeze({ x1: 0, x2: 0, target: 0 }),
    Object.freeze({ x1: 0, x2: 1, target: 1 }),
    Object.freeze({ x1: 1, x2: 0, target: 1 }),
    Object.freeze({ x1: 1, x2: 1, target: 0 }),
  ]);

  #inputWeights = [];
  #hiddenBiases = [];
  #outputWeights = [];
  #outputBias = 0;
  #epoch = 0;
  #learningRate = 0.6;
  #samples;
  #disabledNeurons = new Set();
  #disabledConnections = new Set();

  constructor(seed = 42, { samples = TinyNetwork.samples } = {}) {
    integer(seed, 'seed', -2147483648, 2147483647);
    this.#samples = validatedSamples(samples);
    let state = seed >>> 0;
    const nextSigned = () => {
      // Math.imul preserves the same unsigned 32-bit overflow as the C# model.
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return (state / 4294967295) * 2 - 1;
    };
    for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
      this.#inputWeights[h] = [nextSigned(), nextSigned()];
      this.#hiddenBiases[h] = nextSigned() * 0.1;
      this.#outputWeights[h] = nextSigned() * Math.sqrt(6 / 5);
    }
  }

  get epoch() { return this.#epoch; }
  get architecture() { return 'mlp'; }
  get samples() { return this.#samples; }
  get learningRate() { return this.#learningRate; }
  set learningRate(value) {
    finite(value, 'learningRate');
    if (value <= 0) throw new RangeError('learningRate must be positive.');
    this.#learningRate = value;
  }

  evaluate(x1, x2) {
    finite(x1, 'x1');
    finite(x2, 'x2');
    const inputs = [x1, x2].map((value, index) => this.isNeuronEnabled(0, index) ? value : 0);
    const snapshot = { inputs, rawInputs: [x1, x2], hiddenSums: [], hiddenActivations: [], outputSum: 0, output: 0 };
    let sum = this.#outputBias;
    for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
      const enabled = this.isNeuronEnabled(1, h);
      const z = enabled ? this.#hiddenBiases[h]
        + (this.isConnectionEnabled(1, h, 0) ? this.#inputWeights[h][0] * inputs[0] : 0)
        + (this.isConnectionEnabled(1, h, 1) ? this.#inputWeights[h][1] * inputs[1] : 0) : 0;
      calculation(z);
      const activation = enabled ? Math.tanh(z) : 0;
      snapshot.hiddenSums[h] = z;
      snapshot.hiddenActivations[h] = activation;
      if (this.isConnectionEnabled(2, 0, h)) sum += this.#outputWeights[h] * activation;
    }
    calculation(sum);
    snapshot.outputSum = sum;
    const exp = Math.exp(sum < 0 ? sum : -sum);
    snapshot.output = sum >= 0 ? 1 / (1 + exp) : exp / (1 + exp);
    return snapshot;
  }

  get loss() {
    return this.lossFor(this.#samples);
  }

  lossFor(samples) {
    const data = samples === this.#samples ? samples : validatedSamples(samples);
    let total = 0, scaled = 0;
    for (const { x1, x2, target } of data) {
      const logit = this.evaluate(x1, x2).outputSum;
      // Stable BCE in logit space remains finite for saturated sigmoid outputs.
      const loss = Math.max(logit, 0) - target * logit + Math.log(1 + Math.exp(-Math.abs(logit)));
      total += loss; scaled += loss / data.length;
    }
    const result = Number.isFinite(total) ? total / data.length : scaled;
    finite(result, 'loss'); return result;
  }

  trainEpoch() {
    if (this.#epoch === 2147483647) throw new RangeError('Epoch limit reached.');
    const inputGradient = Array.from({ length: 4 }, () => [0, 0]);
    const hiddenGradient = [0, 0, 0, 0];
    const outputGradient = [0, 0, 0, 0];
    let biasGradient = 0;
    for (const { x1, x2, target } of this.#samples) {
      const forward = this.evaluate(x1, x2);
      const outputDelta = (forward.output - target) / this.#samples.length;
      biasGradient += outputDelta;
      for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
        const activation = forward.hiddenActivations[h];
        if (this.isConnectionEnabled(2, 0, h)) outputGradient[h] += outputDelta * activation;
        const hiddenDelta = this.isConnectionEnabled(2, 0, h)
          ? outputDelta * this.#outputWeights[h] * (1 - activation * activation) : 0;
        hiddenGradient[h] += hiddenDelta;
        for (let i = 0; i < TinyNetwork.inputCount; i++) {
          if (this.isConnectionEnabled(1, h, i)) inputGradient[h][i] += hiddenDelta * forward.inputs[i];
        }
      }
    }
    // Validate a complete candidate before committing any update.
    const next = this.capture();
    for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
      for (let i = 0; i < TinyNetwork.inputCount; i++) next.inputWeights[h][i] -= this.#learningRate * inputGradient[h][i];
      next.hiddenBiases[h] -= this.#learningRate * hiddenGradient[h];
      next.outputWeights[h] -= this.#learningRate * outputGradient[h];
    }
    next.outputBias -= this.#learningRate * biasGradient;
    next.epoch++;
    this.restore(next);
  }

  getWeight(layer, target, source) {
    weightIndex(layer, target, source);
    return layer === 1 ? this.#inputWeights[target][source] : this.#outputWeights[source];
  }

  setWeight(layer, target, source, value) {
    weightIndex(layer, target, source);
    finite(value, 'value');
    if (layer === 1) this.#inputWeights[target][source] = value;
    else this.#outputWeights[source] = value;
  }

  getBias(layer, target) {
    biasIndex(layer, target);
    return layer === 1 ? this.#hiddenBiases[target] : this.#outputBias;
  }

  setBias(layer, target, value) {
    biasIndex(layer, target);
    finite(value, 'value');
    if (layer === 1) this.#hiddenBiases[target] = value;
    else this.#outputBias = value;
  }

  isNeuronEnabled(layer, index) {
    neuronIndex(layer, index);
    return !this.#disabledNeurons.has(`${layer}-${index}`);
  }

  isConnectionEnabled(layer, target, source) {
    weightIndex(layer, target, source);
    return this.isNeuronEnabled(layer, target) && this.isNeuronEnabled(layer - 1, source)
      && !this.#disabledConnections.has(`${layer}-${target}-${source}`);
  }

  setNeuronEnabled(layer, index, enabled) {
    neuronIndex(layer, index);
    if (layer === 2) throw new RangeError('Keep the output available to observe predictions.');
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    const key = `${layer}-${index}`;
    if (enabled) this.#disabledNeurons.delete(key); else this.#disabledNeurons.add(key);
  }

  setConnectionEnabled(layer, target, source, enabled) {
    weightIndex(layer, target, source);
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    const key = `${layer}-${target}-${source}`;
    if (enabled) this.#disabledConnections.delete(key); else this.#disabledConnections.add(key);
  }

  capture() {
    return {
      architecture: 'mlp', samples: this.#samples.map(sample => ({ ...sample })),
      disabledNeurons: [...this.#disabledNeurons].sort(), disabledConnections: [...this.#disabledConnections].sort(),
      inputWeights: this.#inputWeights.map(row => [...row]),
      hiddenBiases: [...this.#hiddenBiases],
      outputWeights: [...this.#outputWeights],
      outputBias: this.#outputBias,
      epoch: this.#epoch,
      learningRate: this.#learningRate,
    };
  }

  restore(parameters) {
    if (parameters == null || typeof parameters !== 'object') throw new TypeError('Parameters are required.');
    if (parameters.architecture && parameters.architecture !== 'mlp') throw new TypeError('Unexpected architecture.');
    const samples = validatedSamples(parameters.samples ?? TinyNetwork.samples);
    const neurons = validatedMask(parameters.disabledNeurons ?? [], false);
    const connections = validatedMask(parameters.disabledConnections ?? [], true);
    dimensions(parameters.inputWeights, 4, 'inputWeights');
    dimensions(parameters.hiddenBiases, 4, 'hiddenBiases');
    dimensions(parameters.outputWeights, 4, 'outputWeights');
    for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
      dimensions(parameters.inputWeights[h], 2, 'inputWeights row');
      for (const value of parameters.inputWeights[h]) finite(value, 'inputWeights');
      finite(parameters.hiddenBiases[h], 'hiddenBiases');
      finite(parameters.outputWeights[h], 'outputWeights');
    }
    finite(parameters.outputBias, 'outputBias');
    finite(parameters.learningRate, 'learningRate');
    integer(parameters.epoch, 'epoch', 0, 2147483647);
    if (parameters.learningRate <= 0) throw new RangeError('learningRate must be positive.');
    this.#samples = samples;
    this.#disabledNeurons = neurons;
    this.#disabledConnections = connections;
    this.#inputWeights = parameters.inputWeights.map(row => [...row]);
    this.#hiddenBiases = [...parameters.hiddenBiases];
    this.#outputWeights = [...parameters.outputWeights];
    this.#outputBias = parameters.outputBias;
    this.#learningRate = parameters.learningRate;
    this.#epoch = parameters.epoch;
  }
}

/** Exact timeline: replay recorded states, then extend training at its end. */
export class TrainingSession {
  #network;
  #history = [];
  #losses = [];
  #historyIndex = 0;

  constructor() { this.reset(); }
  get network() { return this.#network; }
  get historyIndex() { return this.#historyIndex; }
  get historyCount() { return this.#history.length; }
  get losses() { return Object.freeze([...this.#losses]); }

  step(epochs = 10, maximumEpoch = 4000) {
    integer(epochs, 'epochs', 1, 2147483647);
    integer(maximumEpoch, 'maximumEpoch', 0, 2147483647);
    if (this.#historyIndex < this.#history.length - 1) {
      this.#network.restore(this.#history[++this.#historyIndex]);
      return true;
    }
    if (this.#network.epoch >= maximumEpoch) return false;
    const before = this.#network.capture();
    try {
      for (let i = 0; i < epochs && this.#network.epoch < maximumEpoch; i++) this.#network.trainEpoch();
      this.#record();
    } catch (error) { this.#network.restore(before); throw error; }
    return true;
  }

  scrub(index) {
    integer(index, 'index', -2147483648, 2147483647);
    this.#historyIndex = Math.min(Math.max(index, 0), this.#history.length - 1);
    this.#network.restore(this.#history[this.#historyIndex]);
  }

  reset() {
    this.#network = new TinyNetwork();
    this.#history = [];
    this.#losses = [];
    this.#record();
  }

  editWeight(layer, target, source, value) {
    this.#edit(network => network.setWeight(layer, target, source, value));
  }

  editBias(layer, target, value) {
    this.#edit(network => network.setBias(layer, target, value));
  }

  setNeuronEnabled(layer, index, enabled) { this.#edit(network => network.setNeuronEnabled(layer, index, enabled)); }
  setConnectionEnabled(layer, target, source, enabled) { this.#edit(network => network.setConnectionEnabled(layer, target, source, enabled)); }

  captureCheckpoint() {
    return { network: this.#network.capture(), history: this.#history.map(copy), losses: [...this.#losses], historyIndex: this.#historyIndex };
  }

  restoreCheckpoint(checkpoint) {
    if (!checkpoint || !Array.isArray(checkpoint.history) || !checkpoint.history.length) throw new TypeError('Invalid checkpoint.');
    integer(checkpoint.historyIndex, 'historyIndex', 0, checkpoint.history.length - 1);
    dimensions(checkpoint.losses, checkpoint.history.length, 'losses');
    const temporary = new TinyNetwork();
    const history = checkpoint.history.map(parameters => { temporary.restore(parameters); return temporary.capture(); });
    const losses = checkpoint.losses.map(value => { finite(value, 'loss'); if (value < 0) throw new RangeError('Negative loss.'); return value; });
    temporary.restore(checkpoint.network);
    if (JSON.stringify(temporary.capture()) !== JSON.stringify(history[checkpoint.historyIndex])) throw new TypeError('Checkpoint does not match its current history state.');
    this.#network = temporary;
    this.#history = history; this.#losses = losses; this.#historyIndex = checkpoint.historyIndex;
  }

  load(parameters) {
    const network = new TinyNetwork(); network.restore(parameters);
    const loss = storedLoss(network);
    this.#network = network; this.#history = [network.capture()]; this.#losses = [loss]; this.#historyIndex = 0;
  }

  #edit(action) {
    const parameters = this.#network.capture();
    try { action(this.#network); this.#network.loss; }
    catch (error) { this.#network.restore(parameters); throw error; }
    this.#recordEdit();
  }

  #record() {
    const loss = storedLoss(this.#network);
    this.#history.push(this.#network.capture());
    this.#losses.push(loss);
    this.#historyIndex = this.#history.length - 1;
  }

  #recordEdit() {
    const loss = storedLoss(this.#network);
    this.#history.splice(this.#historyIndex + 1);
    this.#losses.splice(this.#historyIndex + 1);
    this.#history[this.#historyIndex] = this.#network.capture();
    this.#losses[this.#historyIndex] = loss;
  }
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function storedLoss(network) { const loss = network.loss, rounded = Math.fround(loss); return Number.isFinite(rounded) ? rounded : loss; }

export function validatedSamples(samples) {
  if (!Array.isArray(samples) || !samples.length) throw new TypeError('A nonempty dataset is required.');
  return Object.freeze(samples.map(sample => {
    if (!sample || typeof sample !== 'object') throw new TypeError('Invalid sample.');
    finite(sample.x1, 'x1'); finite(sample.x2, 'x2');
    if (sample.target !== 0 && sample.target !== 1) throw new RangeError('Labels must be 0 or 1.');
    return Object.freeze({ x1: sample.x1, x2: sample.x2, target: sample.target });
  }));
}

function neuronIndex(layer, index) {
  integer(layer, 'layer', 0, 2);
  integer(index, 'index', 0, layer === 0 ? 1 : layer === 1 ? 3 : 0);
}

function validatedMask(keys, connection) {
  if (!Array.isArray(keys)) throw new TypeError('Invalid mask.');
  const values = keys.map(key => {
    if (typeof key !== 'string' || !(connection ? /^[12]-[0-3]-[0-3]$/ : /^[01]-[0-3]$/).test(key)) throw new TypeError('Invalid mask key.');
    const indices = key.split('-').map(Number);
    if (connection) weightIndex(...indices); else neuronIndex(...indices);
    return key;
  });
  return new Set(values);
}

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be a finite number.`);
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is outside its integer range.`);
}

function dimensions(value, length, name) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`Unexpected ${name} dimensions.`);
}

function biasIndex(layer, target) {
  if (layer !== 1 && layer !== 2) throw new RangeError('Only hidden (1) and output (2) layers have parameters.');
  integer(target, 'target', 0, layer === 1 ? 3 : 0);
}

function weightIndex(layer, target, source) {
  biasIndex(layer, target);
  integer(source, 'source', 0, layer === 1 ? 1 : 3);
}

function calculation(value) {
  if (!Number.isFinite(value)) throw new RangeError('The parameter or input magnitude caused numerical overflow.');
}
