/** Apply the same central crop as CSS object-fit: cover to a camera matrix. */
export function coverProjection(source, videoWidth, videoHeight, viewportWidth, viewportHeight) {
  if (![videoWidth, videoHeight, viewportWidth, viewportHeight].every((value) => value > 0 && Number.isFinite(value))) {
    throw new RangeError('La cámara y el visor deben tener dimensiones positivas.');
  }
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const sx = videoWidth * scale / viewportWidth;
  const sy = videoHeight * scale / viewportHeight;
  const result = Array.from(source);
  for (let column = 0; column < 4; column += 1) {
    result[column * 4] *= sx;
    result[column * 4 + 1] *= sy;
  }
  return result;
}

export const MARKER_WIDTH_METERS = 0.14;
// The SDK 0.3.2 C++ pose binding accepts an integer width. Use millimetres
// internally; passing 0.14 would be truncated to zero before pose estimation.
export const MARKER_WIDTH_MILLIMETERS = MARKER_WIDTH_METERS * 1000;
export const POSE_METERS_PER_UNIT = 0.001;
export const PATTERN_RATIO = 5 / 7;
export const PAYLOAD_ROWS = Object.freeze(['10110', '01101', '11000', '00111', '10010']);

/** ARToolKit's .patt format: four anticlockwise rotations, B/G/R planes of 16² samples. */
export function createPatternText(rows = PAYLOAD_ROWS) {
  const size = 16;
  const samples = [];
  for (let y = 0; y < size; y += 1) {
    samples[y] = [];
    for (let x = 0; x < size; x += 1) {
      // Area averaging preserves the printed cell edges when reducing 5² to 16².
      const left = x * 5 / size;
      const right = (x + 1) * 5 / size;
      const top = y * 5 / size;
      const bottom = (y + 1) * 5 / size;
      let whiteArea = 0;
      for (let row = Math.floor(top); row < Math.ceil(bottom); row += 1) {
        for (let column = Math.floor(left); column < Math.ceil(right); column += 1) {
          const overlap = Math.max(0, Math.min(right, column + 1) - Math.max(left, column))
            * Math.max(0, Math.min(bottom, row + 1) - Math.max(top, row));
          if (rows[row][column] === '1') whiteArea += overlap;
        }
      }
      samples[y][x] = Math.round(255 * whiteArea / ((right - left) * (bottom - top)));
    }
  }
  const orientations = [];
  let image = samples;
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const plane = image.map((row) => row.map((value) => String(value).padStart(3)).join(' ')).join('\n');
    orientations.push(`${plane}\n${plane}\n${plane}\n`);
    image = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => image[x][size - 1 - y]));
  }
  return orientations.join('\n');
}
