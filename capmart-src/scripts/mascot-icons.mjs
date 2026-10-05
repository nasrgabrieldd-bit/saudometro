import fs from 'node:fs';
const original = fs.readFileSync('public/capivara.jpg').toString('base64');
fs.mkdirSync('public/icons', { recursive: true });
for (const size of [64, 128, 256, 512]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128"><title>CapMart — capivara no patinete com tartaruga</title><rect x="1" y="1" width="126" height="126" rx="28" fill="#fff" stroke="#f8cedd" stroke-width="2"/><image href="data:image/jpeg;base64,${original}" x="17" y="7" width="94" height="114" preserveAspectRatio="xMidYMid meet"/></svg>`;
  fs.writeFileSync(`public/icons/capmart-${size}.svg`, svg);
}
fs.writeFileSync('public/mascot-assets.json', JSON.stringify({ original: '/capivara.jpg', aspectRatio: '675:843', icons: [64, 128, 256, 512].map(size => ({ size, src: `/icons/capmart-${size}.svg` })) }, null, 2));
console.log('Ícones 64, 128, 256 e 512 preparados com a imagem original intacta.');
