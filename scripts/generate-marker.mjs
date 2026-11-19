import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// Technical fiducial: its cells are data and must exactly match the detector.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definition = fs.readFileSync(path.join(root, 'Assets/NeuroAR/Scripts/Vision/MarkerDefinition.cs'), 'utf8');
const rows = [...definition.matchAll(/"([01]{5})"/g)].map(match => match[1]);
if (rows.length !== 5) throw new Error('Expected exactly five payload rows in MarkerDefinition.cs.');
const white = (row, col) => row > 0 && row < 6 && col > 0 && col < 6 && rows[row - 1][col - 1] === '1';
const folder = path.join(root, 'Docs/Markers');
fs.mkdirSync(folder, { recursive: true });
let squares = '';
for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
  if (white(row, col)) squares += `  <rect x="${(col + 1) * 100}" y="${(row + 1) * 100}" width="100" height="100" fill="white"/>\n`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="180mm" viewBox="0 0 900 900" shape-rendering="crispEdges">
  <title>Marcador NeuroAR · cuadrado negro exterior de 140 mm</title>
  <desc>Patrón binario 7 por 7 con zona blanca de seguridad. Imprimir al cien por ciento. Datos interiores: ${rows.join('/')}. No es un código QR.</desc>
  <rect width="900" height="900" fill="white"/>
  <rect x="100" y="100" width="700" height="700" fill="black"/>
${squares}</svg>
`;
fs.writeFileSync(path.join(folder, 'neuroar-marker.svg'), svg);

const cellPixels = 120;
const size = cellPixels * 9;
const grayscale = Buffer.alloc(size * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const row = Math.floor(y / cellPixels) - 1;
  const col = Math.floor(x / cellPixels) - 1;
  const quiet = row < 0 || row > 6 || col < 0 || col > 6;
  grayscale[y * size + x] = quiet || white(row, col) ? 255 : 0;
}
const raw = Buffer.alloc((size + 1) * size);
for (let y = 0; y < size; y++) grayscale.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8; // 8-bit grayscale, PNG color type 0.
const physical = Buffer.alloc(9);
physical.writeUInt32BE(6000, 0);
physical.writeUInt32BE(6000, 4);
physical[8] = 1; // Metres: 840 px black square / 6000 px per metre = 0.14 m.
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('pHYs', physical),
  chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.join(folder, 'neuroar-marker.png'), png);
const checks = path.join(root, 'Builds/Checks');
fs.mkdirSync(checks, { recursive: true });
fs.writeFileSync(path.join(checks, 'marker-fixture.pgm'), Buffer.concat([Buffer.from(`P5\n${size} ${size}\n255\n`), grayscale]));

const html = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Imprimir marcador NeuroAR</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 180mm; font: 14px/1.5 system-ui, sans-serif; color: #111; background: white; }
  h1 { margin: 0 0 3mm; font-size: 23px; }
  p { margin: 0 0 3mm; }
  img { display: block; width: 180mm; height: 180mm; max-width: none; image-rendering: pixelated; }
  .ruler { width: 50mm; height: 4mm; border: 1px solid; border-top: 0; margin: 4mm 0 2mm; }
  button { padding: 10px 16px; font: inherit; margin: 12px 0; }
  @media screen { body { padding: 12px; overflow-x: auto; } }
  @media print { button { display: none; } }
</style>
<h1>NeuroAR · marcador de cámara</h1>
<p>Imprime en A4, a escala <strong>100 % / tamaño real</strong>. Desactiva encabezados y pies de página. Usa papel mate y conserva todo el margen blanco.</p>
<button type="button" onclick="window.print()">Imprimir marcador</button>
<img src="neuroar-marker.svg" alt="Patrón binario de referencia para la cámara de NeuroAR">
<p>El cuadrado negro exterior debe medir <strong>14 × 14 cm</strong>. La imagen completa con margen blanco mide 18 × 18 cm. Comprueba con una regla antes de usarla.</p>
<div class="ruler" aria-label="Referencia de impresión de cinco centímetros"></div>
<p>Esta línea mide 5 cm. En la aplicación toca <strong>Ver marcador</strong>, apunta al patrón completo y mantenlo visible.</p>
</html>
`;
fs.writeFileSync(path.join(folder, 'imprimir-marcador.html'), html);
console.log('Marker assets generated: SVG, PNG 1080×1080, A4 print sheet; outer black square = 140 mm.');
console.log(`Payload: ${rows.join('/')}`);
