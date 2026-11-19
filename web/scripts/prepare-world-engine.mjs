import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = new URL('../node_modules/@8thwall/engine-binary/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
if (metadata.version !== '1.0.0') throw new Error('Unexpected XR Engine version; review the dependency before distributing it.');
const destination = new URL('../public/external/xr/', import.meta.url);
await mkdir(destination, { recursive: true });
// Copy the original distribution without transforming, bundling or inspecting it.
await cp(new URL('dist/', packageRoot), destination, { recursive: true });
await stat(new URL('xr.js', destination));
const license = await readFile(new URL('LICENSE', packageRoot));
await mkdir(new URL('../public/licenses/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/licenses/8thwall-engine.txt', import.meta.url), license);
await writeFile(new URL('engine-version.json', destination), JSON.stringify({ name: metadata.name, version: metadata.version }, null, 2) + '\n');
console.log(`Original XR Engine ${metadata.version} prepared in ${fileURLToPath(destination)} (loaded when AR starts).`);
