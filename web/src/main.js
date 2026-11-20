import './styles.css';
import { TinyNetwork } from './core/network.js';
import { LearningLab, explainSelection } from './core/learning-lab.js';
import { NetworkView } from './network-view.js';
import { WorldTracker } from './ar/world-tracker.js';
import { formatDiagnostics } from './ar/diagnostics-view.js';

const $ = (id) => document.getElementById(id);
const n = (value) => Number(value).toFixed(3);
const sub = (value) => String(value).replace(/[0-9]/g, digit => '₀₁₂₃₄₅₆₇₈₉'[digit]);
const label = (layer, index) => layer === 0 ? `x${sub(index + 1)}` : layer === 1 ? `h${sub(index + 1)}` : 'y';
const lab = new LearningLab();
let session = lab.session;
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
let diagnosticText = 'NeuroAR · todavía no se ha iniciado una sesión de RA.';
let learningMode = 'guided', guideIndex = 0, signalStep = null;
let insideVisible = false, compareVisible = false, mapVisible = false, spatialDetailOpen = false;
let mapCache, hintIndex = 0;
const SIGNALS = ['Entradas: posiciones de los interruptores', 'Cada entrada aporta su valor multiplicado por un peso',
  'Las neuronas intermedias suman, añaden un sesgo y aplican tanh',
  'La salida combina las respuestas intermedias', 'La sigmoide produce la predicción de la lámpara'];
const GUIDE = [
  ['Prueba los interruptores', 'La lámpara debe encenderse cuando sus posiciones son diferentes. La red intenta descubrir esa regla.', 'Cambiar un interruptor'],
  ['Mira qué recibe la red', 'Las dos entradas representan los interruptores. Toca una para ver qué contiene.', 'Explorar una entrada'],
  ['Sigue una respuesta', 'La información se combina y transforma antes de llegar a la salida. Avanza a tu ritmo.', 'Seguir la señal'],
  ['Deja que practique', 'Al entrenar, cambian los pesos y sesgos. Observa cuáles de los cuatro ejemplos logra resolver.', 'Entrenar la red'],
  ['Haz un experimento', 'Una conexión influye en el resultado. Desconéctala, observa qué cambia y después restaura la red.', 'Probar un corte'],
  ['Ya puedes explorar', 'Prueba el reto de reparación, abre una neurona o compara arquitecturas. Las matemáticas están disponibles cuando las necesites.', 'Abrir experimentos'],
];

// Move controls, never the stage or its camera/WebGL canvases. Keeping the same
// elements preserves training state and listeners when entering immersive AR.
const immersivePanels = [
  [document.querySelector('.learning-mode'), $('ar-mode-slot')],
  [document.querySelector('.experiment-bar'), $('ar-experiment-slot')],
  [document.querySelector('.learning-score'), $('ar-score-slot')],
  [document.querySelector('.training'), $('ar-training-slot')],
  [document.querySelector('.learning-panel'), $('ar-learning-slot')],
  [$('ar-diagnostics'), $('ar-diagnostic-slot')],
].map(([element, slot]) => {
  const home = document.createComment('Control position outside AR');
  element.before(home);
  return { element, slot, home };
});

function setArMenu(open, { focus = true } = {}) {
  const visible = arMode && open;
  $('ar-menu').hidden = !visible;
  $('toggle-ar-menu').setAttribute('aria-expanded', String(visible));
  if (focus && arMode) (visible ? $('close-ar-menu') : $('toggle-ar-menu')).focus();
}

function setImmersiveLayout(enabled) {
  setArMenu(false, { focus: false });
  for (const { element, slot, home } of immersivePanels) {
    if (enabled) slot.append(element);
    else home.after(element);
  }
  $('ar-hud').hidden = !enabled;
  $('fullscreen-feedback').textContent = '';
  if (!enabled && document.fullscreenElement === document.querySelector('.scene-frame')) {
    void document.exitFullscreen().catch(() => {});
  }
}

function showDiagnostics(packet) {
  const formatted = formatDiagnostics(packet);
  $('ar-diagnostics').hidden = false;
  $('diagnostic-camera').textContent = formatted.camera;
  $('diagnostic-movement').textContent = formatted.movement;
  $('diagnostic-target').textContent = formatted.target;
  $('diagnostic-reason').textContent = formatted.reason;
  $('restart-tracking').disabled = !tracker?.active;
  diagnosticText = formatted.copyText;
}

function select(selection) {
  selected = selection;
  insideVisible = false; spatialDetailOpen = true;
  if (learningMode === 'guided' && guideIndex === 1 && selection.kind === 'neuron' && selection.layer === 0) guideIndex = 2;
  view?.select(selection);
  refresh();
}

try {
  view = new NetworkView({ stage: $('stage'), onSelect: select });
  if (view.available === false) throw new Error('WebGL no disponible');
  tracker = new WorldTracker({
    renderer: view.renderer, camera: view.arCamera, anchor: view.anchor,
    onStatus: message => { if (arMode || startingCamera) $('tracking-status').textContent = message; },
    onTracking: visible => { $('stage').setAttribute('aria-label', visible ? 'Seguimiento espacial activo; coloca la red o explora sus neuronas' : 'Reconociendo el entorno con la cámara'); },
    onPlacement: placed => {
      view.setPlacementState(placed);
      if (!placed) { insideVisible = false; spatialDetailOpen = false; renderGuide(); }
      $('place-button').hidden = placed;
      $('reset-view').textContent = arMode ? 'Volver a colocar' : 'Centrar vista';
      $('reset-view').hidden = arMode && !placed;
    },
    onReticle: pose => {
      view.setReticle(pose);
      $('place-button').disabled = !pose;
      $('place-button').textContent = !pose ? 'Buscando punto de colocación…'
        : pose.type === 'FEATURE_POINT' ? 'Colocar en este punto 3D' : 'Colocar en esta superficie';
    },
    onDiagnostics: showDiagnostics,
    onRender: milliseconds => view.renderTrackedFrame(milliseconds),
    onStop: reason => { if (arMode) { setMode(false); $('tracking-status').textContent = reason; } },
  });
  view.onInspectorAction = action => {
    if (action === 'close') { spatialDetailOpen = false; renderGuide(); return; }
    if (action === 'open-neuron') { openNeuron(); return; }
    if (action === 'close-inside') { insideVisible = false; spatialDetailOpen = false; refresh(); return; }
    if (action === 'toggle-connection') { toggleSelection(); return; }
    if (action !== 'increase' && action !== 'decrease') return;
    if (selected.layer === 0) return;
    const current = selected.kind === 'connection'
      ? session.network.getWeight(selected.layer, selected.target, selected.source)
      : session.network.getBias(selected.layer, selected.index);
    editParameter(Number((current + (action === 'increase' ? 0.1 : -0.1)).toFixed(4)));
  };
  view.onPlace = (x, y) => tracker.placeAt(x, y);
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
  button.addEventListener('click', () => chooseSample(i));
  $('samples').append(button);
});

for (let layer = 1; layer <= 2; layer++) {
  for (let target = 0; target < (layer === 1 ? 4 : 1); target++) {
    for (let source = 0; source < (layer === 1 ? 2 : 4); source++) {
      const button = document.createElement('button');
      // The middle dot labels a connection without suggesting a control action.
      button.textContent = `${label(layer - 1, source)} · ${label(layer, target)}`;
      button.dataset.key = `${layer}-${target}-${source}`;
      button.addEventListener('click', () => {
        const selection = { kind: 'connection', layer, target, source };
        if (view?.available) view.choose(selection);
        else select(selection);
      });
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
  const explanation = explainSelection(network, state, selected);
  const blockedConnection = isConnection && (!network.isNeuronEnabled(layer, index) || !network.isNeuronEnabled(layer - 1, selected.source));
  let value, title, kind, resultLabel, result, formula, lesson, hint;
  if (isConnection) {
    value = network.getWeight(layer, index, selected.source);
    const input = layer === 1 ? state.inputs[selected.source] : state.hiddenActivations[selected.source];
    title = `Conexión ${label(layer - 1, selected.source)} · ${label(layer, index)}`;
    kind = 'Peso de una conexión'; resultLabel = 'APORTE A LA SUMA'; result = input * value;
    formula = `entrada × peso\n${n(input)} × ${n(value)} = ${n(result)}`;
    if (!explanation.terms[selected.source].enabled) { result = 0; formula = `Conexión desconectada\naporte = 0 · peso conservado ${n(value)}`; }
    lesson = 'Esta conexión lleva parte de una respuesta a otra neurona. Su peso controla cuánto influye; su signo puede sumar o restar.';
    hint = 'Prueba desconectarla y compara las respuestas. Puedes deshacer el cambio.';
    if (blockedConnection) hint = 'Primero vuelve a conectar su neurona, o pulsa Restaurar antes del corte en los controles.';
  } else if (layer === 0) {
    value = 0; result = state.inputs[index]; title = `Entrada ${label(layer, index)}`;
    kind = 'Datos del ejemplo seleccionado'; resultLabel = 'VALOR DE ENTRADA';
    formula = `${label(layer, index)} = ${n(result)}\nConectada a las 4 neuronas ocultas`;
    if (!explanation.enabled) formula = `Interruptor: ${state.rawInputs[index]}\nEntrada cortada: señal = 0`;
    lesson = 'Esta entrada representa un interruptor: 0 está apagado y 1 está encendido. Es uno de los datos que recibe la red.';
    if (!explanation.enabled) lesson = 'Esta entrada está desconectada. El interruptor conserva su posición, pero su señal aplicada a la red es cero.';
    hint = 'Cambia ese interruptor desde los controles y observa la señal que recibe la red.';
  } else {
    const hidden = layer === 1;
    value = network.getBias(layer, index);
    const sum = hidden ? state.hiddenSums[index] : state.outputSum;
    result = hidden ? state.hiddenActivations[index] : state.output;
    title = hidden ? `Neurona oculta ${label(layer, index)}` : 'Neurona de salida y';
    kind = hidden ? 'Capa oculta · función tanh' : 'Capa de salida · función sigmoide';
    resultLabel = 'RESPUESTA · ACTIVACIÓN';
    formula = `z = Σ(entrada × peso) + sesgo\nz = ${n(sum)}  ·  b = ${n(value)}\n${hidden ? 'tanh' : 'sigmoide'}(${n(sum)}) = ${n(result)}`;
    if (!explanation.enabled) formula = 'Neurona desconectada\nrespuesta = 0\nLos parámetros se conservan.';
    lesson = hidden ? 'Esta neurona combina señales y transforma el resultado antes de enviarlo a la salida. Su respuesta puede ser negativa o positiva.'
      : 'Esta neurona reúne las respuestas anteriores y predice la lámpara. Desde 0.5 predice encendida; por debajo, apagada.';
    hint = hidden ? 'Pulsa Ver por dentro para seguir sus operaciones con los valores actuales.'
      : lab.scenario === 'repair' ? lab.repaired ? 'Recuperaste las cuatro respuestas. Puedes deshacer el cambio y comparar los parámetros.'
        : 'La salida se enciende demasiado pronto. En Valores puedes probar a bajar su sesgo.' : 'Cambia las entradas y compara su predicción con la respuesta correcta.';
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
  $('selection-code').textContent = explanation.code;
  for (const button of $('connection-buttons').children) {
    const active = isConnection && button.dataset.key === `${layer}-${index}-${selected.source}`;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  }
  view?.setInspectorData({ title, kind, resultLabel, result, formula, lesson,
    parameterLabel: isConnection ? 'Modificar peso' : 'Modificar sesgo',
    parameterValue: value, editable: layer > 0, hint, code: explanation.code, canOpen: layer > 0,
    canToggle: isConnection ? !blockedConnection : layer < 2, blockedConnection,
    connected: isConnection ? network.isConnectionEnabled(layer, index, selected.source) : network.isNeuronEnabled(layer, index) });
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
  session = lab.session;
  const state = snapshot();
  const sample = TinyNetwork.samples[sampleIndex];
  view?.render(session.network, state);
  $('prediction').textContent = state.output >= 0.5 ? 'Encendida' : 'Apagada';
  $('prediction-number').textContent = n(state.output);
  $('lamp-icon').classList.toggle('is-on', state.output >= 0.5);
  $('expected').textContent = `Debe estar ${sample.target ? 'encendida' : 'apagada'}`;
  const correct = (state.output >= 0.5 ? 1 : 0) === sample.target;
  $('result-feedback').textContent = correct ? 'Acertó este ejemplo' : 'Todavía se equivoca';
  $('result-feedback').classList.toggle('incorrect', !correct);
  const rows = lab.results;
  $('correct-count').textContent = `${lab.correctCount} de 4 ejemplos resueltos`;
  $('taught-count').textContent = lab.scenario === 'wrong-labels'
    ? `${rows.filter(row => row.predicted === row.taught).length}/4 etiquetas aprendidas · una es incorrecta` : '';
  $('before-after').hidden = !lab.beforeResults;
  $('before-after').textContent = lab.beforeResults ? `Antes: ${lab.beforeResults.filter(row => row.correct).length}/4 · ahora: ${lab.correctCount}/4` : '';
  Array.from($('samples').children).forEach((button, i) => {
    button.classList.toggle('active', sampleIndex === i);
    button.setAttribute('aria-pressed', sampleIndex === i);
    const row = rows[i];
    button.textContent = `${row.x1} · ${row.x2}  ${row.correct ? '✓' : '×'}`;
    button.classList.toggle('case-wrong', !row.correct);
    button.setAttribute('aria-label', `Interruptores ${row.x1} y ${row.x2}; debe ${row.target ? 'encenderse' : 'apagarse'}; la red predice ${row.predicted ? 'encendida' : 'apagada'}`);
  });
  for (const [id, value] of [['one', sample.x1], ['two', sample.x2]]) {
    $(`switch-${id}`).setAttribute('aria-pressed', String(Boolean(value)));
    $(`switch-${id}-label`).textContent = value ? 'Encendido' : 'Apagado';
  }
  $('epoch').textContent = session.network.epoch.toLocaleString('es-PE');
  $('loss').textContent = session.network.loss.toFixed(4);
  $('timeline').max = session.historyCount - 1;
  $('timeline').value = session.historyIndex;
  $('history-label').textContent = `Estado ${session.historyIndex + 1} de ${session.historyCount}`;
  $('step-button').disabled = session.network.epoch >= 4000 && session.historyIndex === session.historyCount - 1;
  $('play-button').disabled = $('step-button').disabled;
  $('undo-experiment').disabled = !lab.canUndo;
  $('restore-cuts').disabled = !lab.cutState;
  $('return-experiment').hidden = !lab.returnState;
  $('repair-tools').hidden = lab.scenario !== 'repair';
  $('experiment-kind').value = lab.scenario;
  $('experiment-description').textContent = lab.scenario === 'repair'
    ? lab.repaired ? 'Reto resuelto: la red vuelve a responder correctamente a los cuatro casos.' : `Reto: recuperar las cuatro respuestas correctas. Ahora resuelve ${lab.correctCount}/4; se alteró el sesgo de salida.`
    : lab.scenario === 'wrong-labels' ? 'Partimos de redes que practicaron XOR durante 3000 rondas. Ahora se enseña que 1 · 1 enciende la lámpara, aunque debe apagarla. El contador empieza en 0 para estas nuevas rondas. Entrena y compara.'
      : lab.scenario === 'trained' ? 'Estado preparado: red entrenada durante 3000 rondas con los cuatro ejemplos XOR.'
        : 'Red inicial: cambia entradas, sigue la señal y observa cómo mejora al entrenar.';
  $('training-summary').textContent = lab.scenario === 'wrong-labels' ? 'La red practica con las etiquetas de este experimento, incluida una equivocada. Los aciertos se comparan con la regla correcta.'
    : 'La red ajusta pesos y sesgos al practicar con los cuatro ejemplos.';
  $('comparison-summary').hidden = !compareVisible;
  $('comparison-results').textContent = `Con oculta: ${lab.correctCount}/4 · sin oculta: ${rows.filter(row => (lab.linear.evaluate(row.x1, row.x2).output >= 0.5 ? 1 : 0) === row.target).length}/4 · ${session.network.epoch} rondas`;
  $('toggle-compare').setAttribute('aria-pressed', String(compareVisible));
  $('toggle-map').setAttribute('aria-pressed', String(mapVisible));
  $('toggle-compare').textContent = compareVisible ? 'Ocultar comparación' : 'Comparar arquitecturas';
  $('toggle-map').textContent = mapVisible ? 'Ocultar mapa' : 'Mostrar mapa de predicciones';
  $('open-neuron').textContent = insideVisible ? 'Cerrar interior' : 'Ver neurona por dentro';
  const connection = selected.kind === 'connection';
  const enabled = connection ? session.network.isConnectionEnabled(selected.layer, selected.target, selected.source) : session.network.isNeuronEnabled(selected.layer, selected.index);
  const blocked = connection && (!session.network.isNeuronEnabled(selected.layer, selected.target) || !session.network.isNeuronEnabled(selected.layer - 1, selected.source));
  $('toggle-selected').disabled = (!connection && selected.layer === 2) || blocked;
  $('toggle-selected').textContent = blocked ? 'Restaura primero su neurona' : enabled ? 'Desconectar selección' : 'Reconectar selección';
  $('signal-description').textContent = signalStep === null ? 'Sigue cómo se calcula una respuesta.' : `${signalStep + 1}/5 · ${SIGNALS[signalStep]}`;
  $('signal-next').textContent = signalStep === 4 ? 'Volver a las entradas' : 'Avanzar una etapa de la señal';
  view?.setSignalStep(signalStep);
  drawLoss(); refreshInspector(); refreshLearningScene(); renderGuide();
}

function pause() {
  playing = false; clearTimeout(playTimer);
  $('play-button').textContent = 'Entrenar';
  $('play-button').setAttribute('aria-pressed', 'false');
}
function step() {
  if (!lab.step(10, 4000)) { pause(); return; }
  refresh();
  if (session.network.epoch >= 4000 && session.historyIndex === session.historyCount - 1) pause();
}
function tick() {
  if (!playing) return;
  if (!lab.step(25, 4000)) { pause(); return; }
  if (learningMode === 'guided' && guideIndex === 3 && lab.correctCount === 4) { guideIndex = 4; pause(); }
  if (lab.network.epoch >= 4000 && lab.session.historyIndex === lab.session.historyCount - 1) pause();
  refresh();
  if (playing) playTimer = setTimeout(tick, 100);
}
$('play-button').addEventListener('click', () => {
  if (playing) { pause(); return; }
  lab.saveUndo();
  playing = true; $('play-button').textContent = 'Pausar'; $('play-button').setAttribute('aria-pressed', 'true'); tick();
});
$('step-button').addEventListener('click', () => { pause(); lab.saveUndo(); step(); });
$('reset-training').addEventListener('click', () => prepareExperiment('initial'));
$('timeline').addEventListener('input', event => { pause(); lab.scrub(Number(event.target.value)); signalStep = null; refresh(); });
function editParameter(value) {
  if (!Number.isFinite(value) || selected.layer === 0) return;
  pause();
  const wasPast = session.historyIndex < session.historyCount - 1;
  lab.edit(selected, value); signalStep = null;
  if (wasPast) $('training-hint').textContent = 'Editaste un estado anterior: el recorrido futuro se recalculará desde aquí.';
  refresh();
}
$('parameter').addEventListener('input', event => editParameter(Number(event.target.value)));
$('pulse-button').addEventListener('click', nextSignal);
$('reset-view').addEventListener('click', () => { if (arMode) { insideVisible = false; spatialDetailOpen = false; tracker?.reposition(); renderGuide(); } else view?.resetView(); });
$('place-button').addEventListener('click', () => tracker?.placeAt());
$('restart-tracking').addEventListener('click', () => tracker?.resetTracking());
$('copy-diagnostics').addEventListener('click', async () => {
  const text = diagnosticText;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-feedback').textContent = 'Estado copiado';
    $('diagnostic-copy').hidden = true;
  } catch {
    $('diagnostic-copy').value = text;
    $('diagnostic-copy').hidden = false;
    $('diagnostic-copy').focus();
    $('diagnostic-copy').select();
    $('copy-feedback').textContent = 'Selecciona y copia el texto';
  }
});
$('model-scale').addEventListener('input', event => {
  const scale = view?.setModelScale(Number(event.target.value)) ?? 1;
  $('scale-value').textContent = `${scale.toFixed(1)}×`;
});

async function setMode(enabled) {
  if ((enabled && arMode) || (startingCamera && enabled) || !view || !tracker) return;
  const ticket = ++modeGeneration;
  pause();
  arMode = enabled;
  insideVisible = false; spatialDetailOpen = false;
  setImmersiveLayout(enabled);
  view.setArMode(enabled);
  document.body.classList.toggle('ar-mode', enabled);
  renderGuide();
  $('ar-tools').hidden = !enabled;
  if (enabled) {
    $('ar-diagnostics').hidden = false;
    $('copy-feedback').textContent = '';
    $('diagnostic-copy').hidden = true;
  }
  $('place-button').hidden = false;
  $('place-button').disabled = true;
  $('mode-ar').classList.toggle('active', enabled);
  $('mode-3d').classList.toggle('active', !enabled);
  $('mode-ar').setAttribute('aria-pressed', enabled);
  $('mode-3d').setAttribute('aria-pressed', !enabled);
  $('reset-view').textContent = enabled ? 'Volver a colocar' : 'Centrar vista';
  $('reset-view').hidden = enabled;
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
$('exit-ar').addEventListener('click', async () => { await setMode(false); $('mode-ar').focus(); });
$('toggle-ar-menu').addEventListener('click', () => setArMenu($('ar-menu').hidden));
$('close-ar-menu').addEventListener('click', () => setArMenu(false));
$('ar-pulse-button').addEventListener('click', () => { setArMenu(false); nextSignal(); });
$('ar-help-button').addEventListener('click', () => $('help-dialog').showModal());
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.querySelector('.scene-frame').requestFullscreen) {
      await document.querySelector('.scene-frame').requestFullscreen({ navigationUI: 'hide' });
    } else $('fullscreen-feedback').textContent = 'La cámara ya ocupa toda el área disponible de la aplicación.';
  } catch {
    $('fullscreen-feedback').textContent = 'La cámara ocupa toda la aplicación. Este navegador mantiene visibles sus propias barras.';
  }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen-button').textContent = document.fullscreenElement ? 'Mostrar barras del navegador' : 'Pantalla completa';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && arMode && !$('ar-menu').hidden && !$('help-dialog').open) setArMenu(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); if (arMode) { startingCamera = false; setMode(false); } }
});
window.addEventListener('pagehide', () => { pause(); tracker?.stop(); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('ar-info-button').addEventListener('click', () => $('help-dialog').showModal());
$('start-ar-from-help').addEventListener('click', () => { $('help-dialog').close(); setMode(true); });
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });

function refreshLearningScene() {
  if (!view?.available) return;
  if (mapVisible && mapCache?.revision !== lab.revision) mapCache = lab.decisionGrid(24);
  const explanation = explainSelection(lab.network, snapshot(), selected);
  view.setLearningData({ inside: insideVisible, compare: compareVisible, map: mapVisible,
    explanation, selectionTitle: $('selection-title').textContent, linear: lab.linear,
    sample: TinyNetwork.samples[sampleIndex], rows: lab.results, grid: mapCache, signalStep });
}

function renderGuide() {
  const step = GUIDE[guideIndex];
  $('guide-card').hidden = learningMode !== 'guided' || spatialDetailOpen || insideVisible;
  $('guide-progress').textContent = `PASO ${guideIndex + 1} DE ${GUIDE.length}`;
  $('guide-title').textContent = step[0]; $('guide-text').textContent = step[1];
  if (guideIndex === 0 || guideIndex === 3) $('guide-text').textContent += ` Ahora resuelve ${lab.correctCount} de los 4 ejemplos.`;
  $('guide-action').textContent = step[2];
  $('guide-next').textContent = guideIndex === GUIDE.length - 1 ? 'Terminar guía' : 'Siguiente';
}

function setLearningMode(mode) {
  learningMode = mode;
  $('learning-guided').classList.toggle('active', mode === 'guided');
  $('learning-free').classList.toggle('active', mode === 'free');
  $('learning-guided').setAttribute('aria-pressed', String(mode === 'guided'));
  $('learning-free').setAttribute('aria-pressed', String(mode === 'free'));
  $('technical-details').open = mode === 'free';
  $('training-details').open = mode === 'free';
  document.body.classList.toggle('guided-mode', mode === 'guided');
  if (view?.inspector) view.inspector.defaultTab = mode === 'guided' ? 'concept' : 'values';
  spatialDetailOpen = false; view?.inspector?.close(); renderGuide();
}

function chooseSample(index) {
  sampleIndex = index; signalStep = null;
  if (learningMode === 'guided' && guideIndex === 0) guideIndex = 1;
  refresh(); view?.pulse();
}

function nextSignal() {
  signalStep = signalStep === null ? 0 : (signalStep + 1) % SIGNALS.length;
  if (learningMode === 'guided' && guideIndex === 2 && signalStep === 4) guideIndex = 3;
  spatialDetailOpen = false; view?.inspector?.close(); refresh();
}

function openNeuron() {
  if (insideVisible) { insideVisible = false; refresh(); return; }
  if (selected.layer === 0) { selected = { kind: 'neuron', layer: 1, index: 0 }; view?.select(selected); }
  insideVisible = true; spatialDetailOpen = false;
  if (arMode) setArMenu(false);
  refresh();
}

function toggleSelection() {
  pause();
  if (!lab.toggle(selected)) return;
  signalStep = null;
  if (learningMode === 'guided' && guideIndex === 4) guideIndex = 5;
  refresh();
}

function prepareExperiment(name, visitor = false) {
  pause();
  try { lab.preset(name, { visitor }); }
  catch (error) { $('experiment-description').textContent = error.message; return; }
  session = lab.session;
  signalStep = null; insideVisible = false; spatialDetailOpen = false; hintIndex = 0;
  $('repair-feedback').textContent = ''; $('training-hint').textContent = 'Entrenar cambia los parámetros. El historial permite volver a estados anteriores.';
  selected = name === 'repair' ? { kind: 'neuron', layer: 2, index: 0 } : { kind: 'neuron', layer: 1, index: 0 };
  view?.select(selected); view?.closeLearning();
  if (visitor) {
    compareVisible = false; mapVisible = false; sampleIndex = 2; guideIndex = 0;
    setLearningMode('guided'); $('experiments-panel').open = false;
    if (arMode) setArMenu(false);
  }
  refresh();
}

$('switch-one').addEventListener('click', () => chooseSample(sampleIndex ^ 2));
$('switch-two').addEventListener('click', () => chooseSample(sampleIndex ^ 1));
$('learning-guided').addEventListener('click', () => { guideIndex = 0; setLearningMode('guided'); if (arMode) setArMenu(false); });
$('learning-free').addEventListener('click', () => { setLearningMode('free'); if (arMode) setArMenu(false); });
$('guide-next').addEventListener('click', () => {
  if (guideIndex === GUIDE.length - 1) setLearningMode('free');
  else { guideIndex++; renderGuide(); }
});
$('guide-action').addEventListener('click', () => {
  if (guideIndex === 0) chooseSample(sampleIndex ^ 2);
  else if (guideIndex === 1) view?.choose({ kind: 'neuron', layer: 0, index: 0 });
  else if (guideIndex === 2) nextSignal();
  else if (guideIndex === 3) { if (!playing) { lab.saveUndo(); playing = true; $('play-button').textContent = 'Pausar'; $('play-button').setAttribute('aria-pressed', 'true'); tick(); } }
  else if (guideIndex === 4) { selected = { kind: 'connection', layer: 1, target: 0, source: 0 }; view?.select(selected); toggleSelection(); }
  else { $('experiments-panel').open = true; if (arMode) setArMenu(true); else $('experiments-panel').scrollIntoView({ block: 'nearest' }); }
});
$('open-neuron').addEventListener('click', openNeuron);
$('toggle-selected').addEventListener('click', toggleSelection);
$('restore-cuts').addEventListener('click', () => { pause(); lab.restoreCuts(); signalStep = null; refresh(); });
$('undo-experiment').addEventListener('click', () => { pause(); lab.undo(); signalStep = null; refresh(); });
$('return-experiment').addEventListener('click', () => { pause(); lab.returnToExperiment(); signalStep = null; insideVisible = false; spatialDetailOpen = false; view?.closeLearning(); refresh(); });
$('load-experiment').addEventListener('click', () => prepareExperiment($('experiment-kind').value));
$('repair-hint').addEventListener('click', () => {
  const hints = ['Observa el caso con ambos interruptores encendidos: la respuesta correcta es apagada.',
    'La salida se enciende demasiado pronto. Prueba a reducir su sesgo.',
    'Toca la neurona de salida y abre Valores. Pulsa − 0.1 varias veces y comprueba los cuatro casos.'];
  $('repair-feedback').textContent = hints[Math.min(hintIndex++, hints.length - 1)];
  selected = { kind: 'neuron', layer: 2, index: 0 }; view?.select(selected); refresh();
});
$('repair-solution').addEventListener('click', () => { pause(); lab.repairSolution(); $('repair-feedback').textContent = 'Se recuperaron los parámetros de la red entrenada. Puedes deshacer para volver al reto.'; refresh(); });
$('toggle-compare').addEventListener('click', () => { compareVisible = !compareVisible; if (arMode) setArMenu(false); refresh(); });
$('toggle-map').addEventListener('click', () => { mapVisible = !mapVisible; if (arMode) setArMenu(false); refresh(); });
$('signal-next').addEventListener('click', nextSignal);
$('signal-reset').addEventListener('click', () => { signalStep = null; refresh(); });
for (const [id, preset] of [['visitor-initial', 'initial'], ['visitor-trained', 'trained'], ['visitor-repair', 'repair']]) {
  $(id).addEventListener('click', () => prepareExperiment(preset, true));
}
setLearningMode('guided');
refresh();
view?.select(selected);
