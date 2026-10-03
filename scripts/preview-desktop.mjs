import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const test=await readFile(resolve(root,'tests/desktop-ui.mjs'),'utf8');
// Same isolated fixtures as the automated UI tests; never loads production services.
const declarations=test.slice(test.indexOf('const today='),test.indexOf('await context.addInitScript'));
const fixtures=declarations.replace(/setTimeout\(\(\)=>\{for\(const page of context.pages\(\)\)[\s\S]*?\},50\);/,"setTimeout(()=>window.__coupleRefresh?.({table:'sweet_notes'}),50);");
const bootstrap=`${fixtures}\nwindow.__fixtureCall=fixture;
window.addEventListener('load',async()=>{
 const api=window.__desktopPreview; api.State.userId=profile.user_id;
 await api.enterApp(profile);
 document.querySelector('#preview-casal').onclick=()=>{api.closeModal();api.enterApp(profile);};
 document.querySelector('#preview-turma').onclick=()=>{api.closeModal();api.enterFriendsMode(group);};
 document.querySelector('#preview-theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';};
});`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml','.jpg':'image/jpeg'};
createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(path==='/sw.js'||path.split('/').some(p=>p.startsWith('.'))){res.writeHead(403);return res.end();}
 let body,type='text/javascript';
 if(path==='/preview-bootstrap.js')body=bootstrap;
 else if(['/js/db.js','/js/friends.js','/js/gameRooms.js','/js/push.js'].includes(path)){
  const source=await readFile(resolve(root,'.'+path),'utf8');const scope=path.split('/').pop().replace('.js','');
  body=[...source.matchAll(/export (async )?function (\w+)/g)].map(([,async,name])=>{
   if(name==='subscribeCoupleChanges')return `export function ${name}(id,cb){window.__coupleRefresh=cb;return ()=>{window.__coupleRefresh=null;};}`;
   if(!async)return `export function ${name}(){return ${name.startsWith('subscribe')?'()=>{}':name==='permissionState'?"'unsupported'":'false'};}`;
   if(scope==='push')return `export async function ${name}(){return false;}`;
   if(scope==='gameRooms')return `export async function ${name}(){return ${name.startsWith('list')?'[]':'null'};}`;
   return `export async function ${name}(...args){return window.__fixtureCall('${scope}','${name}',args);}`;
  }).join('\n');
 }else if(path==='/js/supabaseClient.js')body="export const isConfigured=true;export const SUPABASE_URL='https://example.invalid';export const supabase={rpc:async()=>({data:null,error:null}),auth:{getSession:async()=>({data:{session:null}})}};";
 else if(path==='/js/changelog.js')body='export const unseenChangelogFor=()=>[];export const markChangelogSeen=()=>{};';
 else{
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep))throw Error();
  body=await readFile(file);type=mime[extname(file)]||'application/octet-stream';
  if(path==='/js/app.js')body=body.toString().replace(/\nboot\(\);\s*$/,'\nwindow.__desktopPreview={State,enterApp,enterFriendsMode,closeModal};');
  if(path==='/'||path==='/index.html')body=body.toString().replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self'; worker-src 'none'">`).replace('<body>',`<body><div style="height:64px;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;background:#382435;color:#fff;font:14px sans-serif;padding:6px;box-sizing:border-box;z-index:10000"><span>Prévia interativa · dados de demonstração</span><button id="preview-casal">Casal</button><button id="preview-turma">Turma</button><button id="preview-theme">Tema</button></div><style>#app-shell{height:calc(100dvh - 64px)!important;min-height:0!important}body{display:flex;flex-direction:column}</style><script src="/preview-bootstrap.js"></script>`);
 }
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
}catch{res.writeHead(404);res.end('Não encontrado');}}).listen(5188,'127.0.0.1',()=>console.log('Prévia interativa: http://127.0.0.1:5188'));
