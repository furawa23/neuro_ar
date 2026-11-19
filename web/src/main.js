import './styles.css';
import { TrainingSession, TinyNetwork } from './core/network.js';
import { NetworkView } from './network-view.js';
import { MarkerTracker } from './ar/marker-tracker.js';

const $ = (id) => document.getElementById(id);
const n = (value) => Number(value).toFixed(3);
const sub = (value) => String(value).replace(/[0-9]/g, digit => '₀₁₂₃₄₅₆₇₈₉'[digit]);
const label = (layer, index) => layer === 0 ? `x${sub(index + 1)}` : layer === 1 ? `h${sub(index + 1)}` : 'y';
const session = new TrainingSession();
let selected = { kind: 'neuron', layer: 1, index: 0 };
let sampleIndex = 2;
let playing = false;
let playTimer;
let arMode = false;
let startingCamera = false;
let modeGeneration = 0;
let parameterIdentity;
let parameterExtent = 8;
let view;
let tracker;

function select(selection) {
  selected = selection;
  view?.select(selection);
  refreshInspector();
}

try {
  view = new NetworkView({ stage: $('stage'), onSelect: select });
  if (view.available === false) throw new Error('WebGL no disponible');
  tracker = new MarkerTracker({
    renderer: view.renderer, camera: view.arCamera, anchor: view.anchor,
    onStatus: message => { if (arMode || startingCamera) $('tracking-status').textContent = message; },
    onTracking: visible => { $('stage').setAttribute('aria-label', visible ? 'Red neuronal sobre el marcador visible' : 'Busca el marcador completo con la cámara'); },
    onStop: reason => { if (arMode) { setMode(false); $('tracking-status').textContent = reason; } },
  });
  view.onFrame = time => tracker?.update(time);
} catch (error) {
  console.error(error);
  $('webgl-error').hidden = false;
  $('webgl-error').textContent = 'No se pudo iniciar la vista 3D. Usa Chrome actualizado y comprueba que la aceleración gráfica esté disponible.';
  $('mode-ar').disabled = true;
}

TinyNetwork.samples.forEach((sample, i) => {
  const button = document.createElement('button');
  button.textContent = `${sample.x1}, ${sample.x2}`;
  button.setAttribute('aria-label', `Entradas ${sample.x1} y ${sample.x2}; salida esperada ${sample.target}`);
  button.addEventListener('click', () => { sampleIndex = i; refresh(); view?.pulse(); });
  $('samples').append(button);
});

for (let layer = 1; layer <= 2; layer++) {
  for (let target = 0; target < (layer === 1 ? 4 : 1); target++) {
    for (let source = 0; source < (layer === 1 ? 2 : 4); source++) {
      const button = document.createElement('button');
      // The middle dot labels a connection without suggesting a control action.
      button.textContent = `${label(layer - 1, source)} · ${label(layer, target)}`;
      button.dataset.key = `${layer}-${target}-${source}`;
      button.addEventListener('click', () => select({ kind: 'connection', layer, target, source }));
      $('connection-buttons').append(button);
    }
  }
}

function snapshot() {
  const sample = TinyNetwork.samples[sampleIndex];
  return session.network.evaluate(sample.x1, sample.x2);
}

function refreshInspector() {
  const state = snapshot();
  const network = session.network;
  const isConnection = selected.kind === 'connection';
  const layer = selected.layer;
  const index = isConnection ? selected.target : selected.index;
  let value, title, kind, resultLabel, result, formula, lesson, hint;
  if (isConnection) {
    value = network.getWeight(layer, index, selected.source);
    const input = layer === 1 ? state.inputs[selected.source] : state.hiddenActivations[selected.source];
    title = `Conexión ${label(layer - 1, selected.source)} · ${label(layer, index)}`;
    kind = 'Peso de una conexión'; resultLabel = 'APORTE A LA SUMA'; result = input * value;
    formula = `entrada × peso\n${n(input)} × ${n(value)} = ${n(result)}`;
    lesson = 'El peso controla cuánto influye una entrada. El signo indica si su aporte suma o resta.';
    hint = 'Cambia el peso y observa la predicción de la red.';
  } else if (layer === 0) {
    value = 0; result = state.inputs[index]; title = `Entrada ${label(layer, index)}`;
    kind = 'Datos del ejemplo seleccionado'; resultLabel = 'VALOR DE ENTRADA';
    formula = `${label(layer, index)} = ${n(result)}\nConectada a las 4 neuronas ocultas`;
    lesson = 'Las entradas representan los datos. Prueba los cuatro ejemplos para ver cómo responde la misma red.';
    hint = 'Selecciona una neurona oculta o una conexión para editar.';
  } else {
    const hidden = layer === 1;
    value = network.getBias(layer, index);
    const sum = hidden ? state.hiddenSums[index] : state.outputSum;
    result = hidden ? state.hiddenActivations[index] : state.output;
    title = hidden ? `Neurona oculta ${label(layer, index)}` : 'Neurona de salida y';
    kind = hidden ? 'Capa oculta · función tanh' : 'Capa de salida · función sigmoide';
    resultLabel = 'ACTIVACIÓN';
    formula = `z = Σ(entrada × peso) + sesgo\nz = ${n(sum)}  ·  b = ${n(value)}\n${hidden ? 'tanh' : 'sigmoide'}(${n(sum)}) = ${n(result)}`;
    lesson = hidden ? 'La neurona combina sus entradas y transforma la suma. Toca una conexión para conocer su peso.' : 'La salida estima la clase 1. Se interpreta como 1 desde 0.5; por debajo se interpreta como 0.';
    hint = 'El sesgo desplaza el punto de activación.';
  }
  $('selection-title').textContent = title;
  $('selection-kind').textContent = kind;
  $('activation-label').textContent = resultLabel;
  $('activation-value').textContent = n(result);
  $('formula').textContent = formula;
  $('lesson').textContent = lesson;
  $('parameter-label').textContent = isConnection ? 'Modificar peso' : 'Modificar sesgo';
  $('parameter-value').textContent = layer === 0 ? '—' : n(value);
  $('parameter').disabled = layer === 0;
  const identity = `${selected.kind}-${layer}-${index}-${selected.source ?? ''}`;
  if (identity !== parameterIdentity || Math.abs(value) > parameterExtent) {
    parameterIdentity = identity;
    parameterExtent = Math.max(8, Math.ceil(Math.abs(value) + 1));
  }
  $('parameter').min = -parameterExtent;
  $('parameter').max = parameterExtent;
  $('parameter').value = value;
  $('parameter-hint').textContent = hint;
  for (const button of $('connection-buttons').children) {
    const active = isConnection && button.dataset.key === `${layer}-${index}-${selected.source}`;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  }
}

function drawLoss() {
  const losses = session.losses;
  const max = Math.max(0.05, ...losses);
  const point = i => [losses.length < 2 ? 0 : (i / (losses.length - 1)) * 320, 76 - (losses[i] / max) * 66];
  const path = (start, end) => losses.slice(start, end + 1).map((_, index) => `${index ? 'L' : 'M'}${point(index + start).join(',')}`).join(' ');
  $('loss-path').setAttribute('d', path(0, session.historyIndex));
  $('loss-future').setAttribute('d', path(session.historyIndex, losses.length - 1));
  const current = point(session.historyIndex);
  $('loss-cursor').setAttribute('cx', current[0]);
  $('loss-cursor').setAttribute('cy', current[1]);
  $('loss-chart').setAttribute('aria-label', `Error BCE actual ${n(session.network.loss)}, época ${session.network.epoch}`);
}

function refresh() {
  const state = snapshot();
  const sample = TinyNetwork.samples[sampleIndex];
  view?.render(session.network, state);
  $('prediction').textContent = n(state.output);
  $('expected').textContent = `esperado ${sample.target}`;
  Array.from($('samples').children).forEach((button, i) => {
    button.classList.toggle('active', sampleIndex === i);
    button.setAttribute('aria-pressed', sampleIndex === i);
  });
  $('epoch').textContent = session.network.epoch.toLocaleString('es-PE');
  $('loss').textContent = session.network.loss.toFixed(4);
  $('timeline').max = session.historyCount - 1;
  $('timeline').value = session.historyIndex;
  $('history-label').textContent = `Estado ${session.historyIndex + 1} de ${session.historyCount}`;
  $('step-button').disabled = session.network.epoch >= 4000 && session.historyIndex === session.historyCount - 1;
  $('play-button').disabled = $('step-button').disabled;
  drawLoss(); refreshInspector();
}

function pause() {
  playing = false; clearTimeout(playTimer);
  $('play-button').textContent = 'Entrenar';
  $('play-button').setAttribute('aria-pressed', 'false');
}
function step() {
  if (!session.step(10, 4000)) { pause(); return; }
  refresh();
  if (session.network.epoch >= 4000 && session.historyIndex === session.historyCount - 1) pause();
}
function tick() {
  if (!playing) return;
  step();
  if (playing) playTimer = setTimeout(tick, 100);
}
$('play-button').addEventListener('click', () => {
  if (playing) { pause(); return; }
  playing = true; $('play-button').textContent = 'Pausar'; $('play-button').setAttribute('aria-pressed', 'true'); tick();
});
$('step-button').addEventListener('click', () => { pause(); step(); });
$('reset-training').addEventListener('click', () => { pause(); session.reset(); $('training-hint').textContent = 'Retropropagación sobre 4 ejemplos · puedes pausar y retroceder.'; refresh(); });
$('timeline').addEventListener('input', event => { pause(); session.scrub(Number(event.target.value)); refresh(); });
$('parameter').addEventListener('input', event => {
  pause();
  const value = Number(event.target.value);
  const wasPast = session.historyIndex < session.historyCount - 1;
  if (selected.kind === 'connection') session.editWeight(selected.layer, selected.target, selected.source, value);
  else if (selected.layer > 0) session.editBias(selected.layer, selected.index, value);
  if (wasPast) $('training-hint').textContent = 'Editaste un estado anterior: el recorrido futuro se recalculará desde aquí.';
  refresh();
});
$('pulse-button').addEventListener('click', () => view?.pulse());
$('reset-view').addEventListener('click', () => { if (arMode) $('tracking-status').textContent = 'Muestra el marcador completo, plano y con buena luz.'; else view?.resetView(); });

async function setMode(enabled) {
  if ((startingCamera && enabled) || !view || !tracker) return;
  const ticket = ++modeGeneration;
  pause();
  arMode = enabled;
  view.setArMode(enabled);
  document.body.classList.toggle('ar-mode', enabled);
  $('mode-ar').classList.toggle('active', enabled);
  $('mode-3d').classList.toggle('active', !enabled);
  $('mode-ar').setAttribute('aria-pressed', enabled);
  $('mode-3d').setAttribute('aria-pressed', !enabled);
  $('reset-view').textContent = enabled ? 'Buscar marcador' : 'Centrar vista';
  if (!enabled) {
    startingCamera = false;
    tracker.stop();
    $('mode-ar').disabled = false;
    $('mode-3d').disabled = false;
    $('stage').setAttribute('aria-label', 'Red neuronal tridimensional interactiva');
    $('tracking-status').textContent = 'Arrastra para girar · pellizca para acercarte';
    return;
  }
  startingCamera = true;
  $('mode-ar').disabled = true;
  // The user can cancel while the browser is awaiting camera permission.
  $('mode-3d').disabled = false;
  try { await tracker.start(); }
  catch (error) {
    if (ticket !== modeGeneration) return;
    const message = error.message || 'No se pudo abrir la cámara.';
    startingCamera = false;
    await setMode(false);
    $('tracking-status').textContent = message;
  } finally {
    if (ticket === modeGeneration) {
      startingCamera = false;
      $('mode-ar').disabled = false;
      $('mode-3d').disabled = false;
    }
  }
}
$('mode-ar').addEventListener('click', () => { if (!arMode) setMode(true); });
$('mode-3d').addEventListener('click', () => { if (arMode) setMode(false); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); if (arMode) { startingCamera = false; setMode(false); } }
});
window.addEventListener('pagehide', () => { pause(); tracker?.stop(); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
refresh();
view?.select(selected);
