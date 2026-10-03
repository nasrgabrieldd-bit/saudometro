import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5187);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
 try {
  if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path.split('/').some(part=>part.startsWith('.'))) {res.writeHead(403);res.end();return;}
  const file=resolve(root,`.${path === '/' ? '/index.html' : path}`);
  if(!file.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:data);
 } catch {res.writeHead(404);res.end('Arquivo não encontrado');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Prévia local: http://127.0.0.1:${port}`));
