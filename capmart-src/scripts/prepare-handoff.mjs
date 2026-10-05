import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const directories = ['src', 'integration', 'public', 'scripts', 'tests', 'previews'];
const files = ['.gitignore', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'levels.snapshot.json'];
const denied = /(^|\/)(\.env(?:\..*)?|node_modules|dist|test-results|playwright-report|\.git)(\/|$)|\.(pem|key|p12|pfx|tsbuildinfo)$/i;
for (const name of fs.readdirSync(root)) if (name.endsWith('.md')) files.push(name);
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink() || denied.test(name)) throw new Error(`Arquivo não permitido na entrega: ${name}`);
    if (entry.isDirectory()) walk(name); else if (entry.isFile()) files.push(name);
  }
}
for (const directory of directories) walk(directory);
const levels = JSON.parse(fs.readFileSync('levels.snapshot.json', 'utf8'));
if (levels.length !== 60 || new Set(levels.map(l => l.id)).size !== 60) throw new Error('Catálogo incompleto.');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8').replace(/^\uFEFF/, ''));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (lock.packages[''].version !== packageJson.version) throw new Error('Lockfile divergente.');
const target = path.join(root, 'transfer', new Date().toISOString().replace(/[:.]/g, '-'), 'CapMart');
fs.mkdirSync(target, { recursive: true });
const manifest = [];
for (const file of [...new Set(files)].sort()) {
  if (denied.test(file)) throw new Error(`Arquivo proibido: ${file}`);
  const bytes = fs.readFileSync(path.join(root, file));
  const output = path.join(target, file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  manifest.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
fs.writeFileSync(path.join(target, 'TRANSFER_MANIFEST.json'), JSON.stringify({ version: packageJson.version, createdAt: new Date().toISOString(), integrationStatus: 'pending', files: manifest }, null, 2));
console.log(JSON.stringify({ directory: target, files: manifest.length, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) }));
