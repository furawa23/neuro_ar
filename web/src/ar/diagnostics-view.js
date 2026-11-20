const STATES = new Set([
  'loading', 'camera', 'initializing', 'limited', 'tracking', 'no-target',
  'target', 'placed', 'stopped', 'error',
]);
const VIDEO_STATES = new Set(['live', 'waiting', 'stalled', 'unknown']);
const TRACKING_STATES = new Set(['NORMAL', 'LIMITED']);
const TRACKING_REASONS = new Set(['INITIALIZING', 'UNSPECIFIED', 'UNDEFINED']);
const REJECTIONS = new Set([
  'no-reality', 'tracking-limited', 'invalid-pose', 'stale-video',
  'invalid-projection', 'no-hits', 'invalid-hit',
]);

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const token = (value, choices, fallback) => typeof value === 'string' && choices.has(value) ? value : fallback;

/** Format only the SDK adapter's small diagnostic packet; never copy scene or user data. */
export function formatDiagnostics(packet) {
  const data = packet && typeof packet === 'object' && !Array.isArray(packet) ? packet : {};
  const state = token(data.state, STATES, 'unknown');
  const video = token(data.video, VIDEO_STATES, 'unknown');
  const engineStatus = token(data.engineTrackingStatus, TRACKING_STATES, 'unknown');
  const engineReason = token(data.engineTrackingReason, TRACKING_REASONS, 'unknown');
  const rejection = data.rejection == null ? 'none' : token(data.rejection, REJECTIONS, 'unknown');
  const hits = data.hitCounts && typeof data.hitCounts === 'object' ? data.hitCounts : {};
  const points = count(hits.FEATURE_POINT);
  const estimated = count(hits.ESTIMATED_SURFACE);
  const detected = count(hits.DETECTED_SURFACE);
  const validTargets = count(data.validTargets);
  const rejected = data.hitRejections && typeof data.hitRejections === 'object' ? data.hitRejections : {};
  const age = typeof data.lastPoseAgeMs === 'number' && Number.isFinite(data.lastPoseAgeMs)
    && data.lastPoseAgeMs >= 0 && data.lastPoseAgeMs <= Number.MAX_SAFE_INTEGER
    ? Math.floor(data.lastPoseAgeMs) : null;

  let camera = 'Sin datos';
  if (state === 'stopped') camera = 'Detenida';
  else if (video === 'live') camera = 'Activa';
  else if (video === 'waiting') camera = 'Esperando imágenes';
  else if (video === 'stalled') camera = 'Sin imágenes recientes';
  else if (state === 'loading' || state === 'camera') camera = 'Preparando';

  let movement = 'Esperando seguimiento';
  if (state === 'stopped') movement = 'Detenido';
  else if (video === 'stalled' || rejection === 'stale-video') movement = 'Esperando imagen reciente';
  else if (rejection === 'invalid-pose' || rejection === 'invalid-projection') movement = 'Datos no válidos';
  else if (state === 'initializing' || engineReason === 'INITIALIZING') movement = 'Inicializando';
  else if (state === 'limited' || engineStatus === 'LIMITED' || rejection === 'tracking-limited') movement = 'Limitado';
  else if (engineStatus === 'NORMAL' && ['tracking', 'no-target', 'target', 'placed'].includes(state)) movement = 'Activo según el motor';
  else if (state === 'error') movement = 'Interrumpido';

  let target = 'Esperando seguimiento';
  if (state === 'stopped') target = 'Colocación detenida';
  else if (state === 'placed') target = 'Red colocada según el motor';
  else if (state === 'target' && validTargets > 0) target = `${validTargets} ${validTargets === 1 ? 'punto válido' : 'puntos válidos'}`;
  else if (state === 'no-target' || (state === 'target' && validTargets === 0)) target = 'Sin puntos válidos para colocar';
  else if (state === 'tracking') target = 'Buscando puntos de colocación';
  else if (state === 'loading' || state === 'camera') target = 'Esperando cámara y movimiento';

  let reason = 'Aún no hay información suficiente del seguimiento.';
  if (state === 'stopped') reason = 'La sesión terminó; activa de nuevo la RA para continuar.';
  else if (video === 'stalled' || rejection === 'stale-video') reason = 'La imagen de cámara no es reciente; todavía no se puede validar una colocación.';
  else if (rejection === 'invalid-pose') reason = 'El motor no está entregando una posición y orientación válidas.';
  else if (rejection === 'invalid-projection') reason = 'La proyección de cámara recibida no es válida.';
  else if (state === 'initializing' || engineReason === 'INITIALIZING') reason = 'El motor todavía está reconociendo el movimiento y el entorno.';
  else if (state === 'limited' || rejection === 'tracking-limited') reason = 'El motor informa de seguimiento limitado; mueve el teléfono lentamente sobre una zona con detalles.';
  else if (rejection === 'no-reality') reason = 'La cámara puede estar activa, pero aún no hay datos de posición del motor.';
  else if (rejection === 'invalid-hit') reason = `Resultados rechazados: posición ${count(rejected.position)}, distancia ${count(rejected.distance)}, orientación ${count(rejected.rotation)}.`;
  else if (state === 'no-target' || rejection === 'no-hits') reason = 'Hay seguimiento de movimiento, pero aún no hay puntos válidos en la zona apuntada.';
  else if (state === 'target' && validTargets > 0) reason = 'El motor ofrece un punto para colocar; la estabilidad física debe comprobarse en el teléfono.';
  else if (state === 'placed') reason = 'El motor conserva una colocación; verifica su estabilidad al moverte alrededor.';
  else if (state === 'error') reason = 'El seguimiento se interrumpió; revisa los permisos y el estado de la cámara.';

  const copyText = [
    'NeuroAR · diagnóstico local',
    'revision: puntos3d-2',
    `estado: ${state}`,
    `camara: ${video}`,
    `seguimiento_sdk: ${engineStatus}`,
    `motivo_sdk: ${engineReason}`,
    `rechazo: ${rejection}`,
    `puntos_3d: ${points}`,
    `superficies_estimadas: ${estimated}`,
    `superficies_detectadas: ${detected}`,
    `objetivos_validos: ${validTargets}`,
    `rechazos_posicion: ${count(rejected.position)}`,
    `rechazos_distancia: ${count(rejected.distance)}`,
    `rechazos_orientacion: ${count(rejected.rotation)}`,
    `edad_pose_ms: ${age ?? 'sin dato'}`,
  ].join('\n');

  return { camera, movement, target, reason, copyText };
}
