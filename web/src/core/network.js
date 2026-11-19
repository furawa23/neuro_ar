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

  constructor(seed = 42) {
    integer(seed, 'seed', -2147483648, 2147483647);
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
  get learningRate() { return this.#learningRate; }
  set learningRate(value) {
    finite(value, 'learningRate');
    if (value <= 0) throw new RangeError('learningRate must be positive.');
    this.#learningRate = value;
  }

  evaluate(x1, x2) {
    finite(x1, 'x1');
    finite(x2, 'x2');
    const snapshot = { inputs: [x1, x2], hiddenSums: [], hiddenActivations: [], outputSum: 0, output: 0 };
    let sum = this.#outputBias;
    for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
      const z = this.#inputWeights[h][0] * x1 + this.#inputWeights[h][1] * x2 + this.#hiddenBiases[h];
      calculation(z);
      const activation = Math.tanh(z);
      snapshot.hiddenSums[h] = z;
      snapshot.hiddenActivations[h] = activation;
      sum += this.#outputWeights[h] * activation;
    }
    calculation(sum);
    snapshot.outputSum = sum;
    const exp = Math.exp(sum < 0 ? sum : -sum);
    snapshot.output = sum >= 0 ? 1 / (1 + exp) : exp / (1 + exp);
    return snapshot;
  }

  get loss() {
    let total = 0;
    for (const { x1, x2, target } of TinyNetwork.samples) {
      const logit = this.evaluate(x1, x2).outputSum;
      // Stable BCE in logit space remains finite for saturated sigmoid outputs.
      total += Math.max(logit, 0) - target * logit + Math.log(1 + Math.exp(-Math.abs(logit)));
    }
    return total / TinyNetwork.samples.length;
  }

  trainEpoch() {
    if (this.#epoch === 2147483647) throw new RangeError('Epoch limit reached.');
    const inputGradient = Array.from({ length: 4 }, () => [0, 0]);
    const hiddenGradient = [0, 0, 0, 0];
    const outputGradient = [0, 0, 0, 0];
    let biasGradient = 0;
    for (const { x1, x2, target } of TinyNetwork.samples) {
      const forward = this.evaluate(x1, x2);
      const outputDelta = (forward.output - target) / TinyNetwork.samples.length;
      biasGradient += outputDelta;
      for (let h = 0; h < TinyNetwork.hiddenCount; h++) {
        const activation = forward.hiddenActivations[h];
        outputGradient[h] += outputDelta * activation;
        const hiddenDelta = outputDelta * this.#outputWeights[h] * (1 - activation * activation);
        hiddenGradient[h] += hiddenDelta;
        for (let i = 0; i < TinyNetwork.inputCount; i++) inputGradient[h][i] += hiddenDelta * forward.inputs[i];
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

  capture() {
    return {
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
    for (let i = 0; i < epochs && this.#network.epoch < maximumEpoch; i++) this.#network.trainEpoch();
    this.#record();
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
    this.#network.setWeight(layer, target, source, value);
    this.#recordEdit();
  }

  editBias(layer, target, value) {
    this.#network.setBias(layer, target, value);
    this.#recordEdit();
  }

  #record() {
    this.#history.push(this.#network.capture());
    this.#losses.push(Math.fround(this.#network.loss));
    this.#historyIndex = this.#history.length - 1;
  }

  #recordEdit() {
    this.#history.splice(this.#historyIndex + 1);
    this.#losses.splice(this.#historyIndex + 1);
    this.#history[this.#historyIndex] = this.#network.capture();
    this.#losses[this.#historyIndex] = Math.fround(this.#network.loss);
  }
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
