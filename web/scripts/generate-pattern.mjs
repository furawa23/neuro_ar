import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPatternText, PAYLOAD_ROWS } from '../src/ar/marker-math.js';

const definition = await readFile(new URL('../../Assets/NeuroAR/Scripts/Vision/MarkerDefinition.cs', import.meta.url), 'utf8');
const sourceRows = Array.from(definition.matchAll(/"([01]{5})"/g), (match) => match[1]);
if (JSON.stringify(sourceRows) !== JSON.stringify(PAYLOAD_ROWS)) {
  throw new Error('El patrón web no coincide con el marcador impreso original.');
}
const target = new URL('../public/markers/neuroar-marker.patt', import.meta.url);
await writeFile(target, createPatternText());
console.log(`ARToolKit pattern generated: ${fileURLToPath(target)}; ratio 5/7, outer edge 14 cm.`);
