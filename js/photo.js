// Comprime uma foto no próprio navegador antes de enviar, sem depender de nenhuma biblioteca:
// desenha a imagem num <canvas> menor e exporta como JPEG. Deixa a foto bem mais leve
// (geralmente 100–300 KB), pra o espaço gratuito de armazenamento render bem mais.
const MAX_DIM = 1280; // maior lado da foto, em pixels
const QUALITY = 0.75;

export async function compressImage(file, maxDim = MAX_DIM) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não deu pra comprimir a imagem"))), "image/jpeg", QUALITY);
    });
    return blob;
  } finally {
    bitmap.close?.();
  }
}
