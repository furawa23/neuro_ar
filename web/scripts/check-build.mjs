import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

function htmlReferences(html) {
  return [...html.matchAll(/<(?:script|link|a|img)\b[^>]*>/gi)]
    .map(([tag]) => tag.match(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/i)?.[2])
    .filter(Boolean);
}

function moduleReferences(source) {
  const expressions = [
    /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g,
    /\b(?:import|export)\s*(?:[^;"'()]*?\bfrom\s*)?(["'])([^"']+)\1/g,
    /\bnew\s+URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g,
  ];
  return expressions.flatMap(expression => [...source.matchAll(expression)].map(match => match[2]));
}

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

async function checkPrefix(prefix, files) {
  // No SPA fallback and no alternative root mount: a leaked /assets or /markers
  // URL must fail here just as it would on a GitHub Pages project site.
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const relative = pathname.slice(prefix.length);
      const target = path.resolve(dist, relative || 'index.html');
      const contained = path.relative(dist, target);
      if (contained.startsWith(`..${path.sep}`) || contained === '..' || path.isAbsolute(contained)) {
        response.writeHead(404).end(); return;
      }
      if (!(await stat(target)).isFile()) { response.writeHead(404).end(); return; }
      const body = await readFile(target);
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = new URL(prefix, origin);
  const checked = new Map();
  const resolveLocal = (reference, from) => {
    if (reference.startsWith('#') || /^(?:data:|mailto:|tel:|javascript:)/i.test(reference)) return null;
    const resolved = new URL(reference.replaceAll('&amp;', '&'), from);
    if (resolved.origin !== origin) return null;
    assert.ok(resolved.pathname.startsWith(prefix), `La ruta ${reference} escapa de ${prefix} desde ${from}`);
    resolved.hash = '';
    return resolved;
  };
  const get = async url => {
    const key = url.href;
    if (!checked.has(key)) {
      const response = await fetch(url);
      assert.equal(response.status, 200, `Recurso inaccesible bajo ${prefix}: ${url.pathname}`);
      const body = Buffer.from(await response.arrayBuffer());
      assert.ok(body.length > 0, `Recurso vacío: ${url.pathname}`);
      checked.set(key, body);
    }
    return checked.get(key);
  };
  try {
    const missing = await fetch(new URL(`${prefix}__neuroar_missing__`, origin));
    assert.equal(missing.status, 404, 'El servidor de prueba no debe ocultar rutas inexistentes.');
    const index = (await get(base)).toString('utf8');
    for (const reference of htmlReferences(index)) {
      const url = resolveLocal(reference, base);
      if (url) await get(url);
    }
    for (const file of files) {
      if (file.startsWith('external/xr/')) {
        // Opaque vendor artifacts are served intact; do not parse their code.
        await get(new URL(file, base));
        continue;
      }
      if (!/\.(?:js|css)$/.test(file)) continue;
      const url = new URL(file, base);
      const source = (await get(url)).toString('utf8');
      const references = file.endsWith('.js') ? moduleReferences(source)
        : [...source.matchAll(/url\(\s*(["']?)([^\s"')]+)\1\s*\)/g)].map(match => match[2]);
      for (const reference of references) {
        const linked = resolveLocal(reference, url);
        if (linked) await get(linked);
      }
    }
    const manifestUrl = new URL('manifest.webmanifest', base);
    const manifest = JSON.parse((await get(manifestUrl)).toString('utf8'));
    for (const field of ['id', 'scope', 'start_url']) {
      assert.equal(typeof manifest[field], 'string', `Falta ${field} en el manifiesto.`);
      assert.equal(new URL(manifest[field], manifestUrl).href, base.href, `${field} debe abrir ${prefix}`);
    }
    assert.ok(manifest.icons?.length, 'El manifiesto debe incluir un icono.');
    for (const icon of manifest.icons) {
      const url = resolveLocal(icon.src, manifestUrl);
      assert.ok(url, 'El icono del manifiesto debe alojarse con la aplicación.');
      await get(url);
    }
    const printUrl = new URL('markers/imprimir-marcador.html', base);
    const printHtml = (await get(printUrl)).toString('utf8');
    for (const reference of htmlReferences(printHtml)) {
      const url = resolveLocal(reference, printUrl);
      if (url) await get(url);
    }
    for (const file of ['neuroar-marker.svg', 'neuroar-marker.png', 'neuroar-marker.patt', 'camera_para.dat']) {
      await get(new URL(`markers/${file}`, base));
    }
    if (prefix !== '/') {
      const asset = files.find(file => /^assets\/.*\.js$/.test(file));
      assert.ok(asset, 'La compilación debe incluir JavaScript.');
      for (const leaked of ['/', `/${asset}`, '/markers/camera_para.dat', '/manifest.webmanifest']) {
        const response = await fetch(new URL(leaked, origin));
        assert.equal(response.status, 404, `La prueba de subruta no debe servir ${leaked} desde la raíz.`);
      }
    }
    console.log(`PASS: ${checked.size} recursos de producción y manifiesto bajo ${prefix}, sin fallback.`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

try {
  try { await stat(path.join(dist, 'index.html')); }
  catch { throw new Error('No existe web/dist/index.html. Ejecuta npm run build antes de npm run check:build.'); }
  const files = await listFiles(dist);
  assert.ok(files.some(file => /^assets\/.*\.js$/.test(file)), 'La compilación no contiene módulos JavaScript.');
  const engineRoot = fileURLToPath(new URL('../node_modules/@8thwall/engine-binary/dist/', import.meta.url));
  const engineFiles = await listFiles(engineRoot);
  assert.ok(engineFiles.includes('xr.js') && engineFiles.includes('xr-slam.js'), 'Falta el motor con seguimiento espacial.');
  for (const file of engineFiles) {
    const original = await readFile(path.join(engineRoot, file));
    const distributed = await readFile(path.join(dist, 'external/xr', file));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(distributed), hash(original), `El motor debe distribuirse sin cambios: ${file}`);
  }
  await stat(path.join(dist, 'licenses/8thwall-engine.txt'));
  console.log(`PASS: ${engineFiles.length} archivos originales de XR Engine sin modificaciones.`);
  for (const prefix of ['/', '/neuro_ar/']) await checkPrefix(prefix, files);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
