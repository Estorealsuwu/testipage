import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const directory of ['api', 'lib', 'public']) {
  for (const name of await readdir(new URL(`${directory}/`, root))) {
    if (!/\.m?js$/.test(name)) continue;
    const file = fileURLToPath(new URL(`${directory}/${name}`, root));
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
}
for (const file of ['package.json', 'vercel.json']) JSON.parse(await readFile(new URL(file, root), 'utf8'));
console.log('JavaScript y configuración verificados.');
