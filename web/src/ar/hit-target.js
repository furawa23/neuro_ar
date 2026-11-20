const SURFACES = new Set(['ESTIMATED_SURFACE', 'DETECTED_SURFACE']);

function vector(value) {
  if (!value || typeof value !== 'object') return null;
  const values = Array.isArray(value) || ArrayBuffer.isView(value)
    ? [value[0], value[1], value[2]] : [value.x, value.y, value.z];
  return values.every(Number.isFinite) ? { x: values[0], y: values[1], z: values[2] } : null;
}

function quaternion(value) {
  if (!value || typeof value !== 'object') return null;
  const values = Array.isArray(value) || ArrayBuffer.isView(value)
    ? [value[0], value[1], value[2], value[3]] : [value.x, value.y, value.z, value.w];
  if (!values.every(Number.isFinite)) return null;
  const length = Math.hypot(...values);
  if (!(length > 1e-8)) return null;
  return { x: values[0] / length, y: values[1] / length, z: values[2] / length, w: values[3] / length };
}

/**
 * A feature point supplies a location, not a measured surface orientation.
 * Accept only real SDK coordinates; model heading and geometric distance are
 * derived from those coordinates and the already validated tracked camera.
 */
export function normalizeHitTarget(hit, cameraPosition) {
  if (!hit || (hit.type !== 'FEATURE_POINT' && !SURFACES.has(hit.type))) return { rejection: 'type' };
  const position = vector(hit.position);
  if (!position) return { rejection: 'position' };
  const camera = vector(cameraPosition);
  if (!camera) return { rejection: 'position' };
  const dx = camera.x - position.x;
  const dy = camera.y - position.y;
  const dz = camera.z - position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance) || distance <= 0.01 || distance >= 15) return { rejection: 'distance' };

  let rotation;
  if (hit.type === 'FEATURE_POINT') {
    // Choose the educational model's heading once. This never invents a point
    // or turns camera movement into anchor movement after placement.
    const halfYaw = Math.atan2(dx, dz) / 2;
    rotation = { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) };
  } else {
    rotation = quaternion(hit.rotation);
    if (!rotation) return { rejection: 'rotation' };
  }
  return { target: { type: hit.type, position, rotation, distance }, rejection: null };
}
