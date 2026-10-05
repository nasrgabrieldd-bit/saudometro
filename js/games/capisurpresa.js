// Motor puro da Capisurpresa: formato da composição, modelos, adesivos, preço e o
// renderizador SVG — nada aqui sabe de Supabase, sala, casal ou turma. Portado do pacote
// React/TypeScript recebido (mesmo formato de dados e mesma regra de preço), só que sem
// framework: o app inteiro é vanilla JS sem build step, então o editor vira manipulação
// direta de SVG via pointer events em vez de estado do React.

// um elemento da composição: texto, adesivo (Capilover), foto, decoração (emoji) ou
// traço de desenho (polyline)
// Element = {id, kind: 'text'|'sticker'|'photo'|'decor'|'stroke', content, x, y, w,
//            rotation, color, font, size, align, points?, crop?}
// Composition = {version:1, template, background, expression, elements:[Element]}

export const STICKERS = [
  { id: "fitness", name: "Fitness", category: "Energia" },
  { id: "banana", name: "Divertido", category: "Carinho" },
  { id: "soninho", name: "Soninho", category: "Descanso" },
  { id: "corredor", name: "Corredor", category: "Energia" },
];
export const STICKER_SRC = (id) => `icons/capilovers/${id}.png`;

export const TEMPLATES = [
  { id: "smile", name: "Sorrisinho", description: "Um sorriso muda o dia.", color: "#ff914d", tag: "SIMPLES", symbol: "☺" },
  { id: "sign", name: "Uma plaquinha", description: "Um recado de braços abertos.", color: "#ffb587", tag: "CRIATIVO", symbol: "♧" },
  { id: "quote", name: "Só uma frase", description: "Poucas palavras. Muito carinho.", color: "#d9d5f5", tag: "ESSENCIAL", symbol: "Aa" },
  { id: "note", name: "Post-it", description: "Um bilhetinho só de vocês.", color: "#ffe79d", tag: "QUERIDINHO", symbol: "✎" },
  { id: "capi", name: "Capilovers", description: "Carinho em forma de capivara.", color: "#d7e8d8", tag: "FOFINHO", symbol: "♡" },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export const EXPRESSIONS = ["Feliz", "Apaixonado", "Animado", "Sonolento", "Engraçado", "Surpreso"];
export const DURATIONS = [15, 30, 60, 180, 0]; // minutos; 0 = "até abrir"
export const DURATION_LABEL = { 15: "15 minutos", 30: "30 minutos", 60: "1 hora", 180: "3 horas", 0: "Até abrir" };

export function newElement(kind, content) {
  return {
    id: crypto.randomUUID(), kind, content,
    x: 200, y: kind === "sticker" ? 285 : 180,
    w: kind === "sticker" ? 170 : 300,
    rotation: 0, color: "#533e36", font: "sans-serif", size: 32, align: "center",
  };
}

// cada modelo começa com um texto de exemplo já no lugar certo — a pessoa edita à vontade
export function createComposition(templateId) {
  const t = TEMPLATE_BY_ID[templateId];
  if (!t) throw new Error("modelo inválido");
  const defaultText = {
    quote: "você faz meu\ndia mais bonito.",
    sign: "VOCÊ CONSEGUE!",
    note: "lembrei de você ♡",
  }[templateId] || "um carinho pra você";
  const textEl = { ...newElement("text", defaultText), y: templateId === "smile" ? 350 : templateId === "capi" ? 410 : 190 };
  const elements = [textEl];
  if (templateId === "capi") elements.push(newElement("sticker", "banana"));
  return { version: 1, template: templateId, background: t.color, expression: "Feliz", elements };
}

// preço: foto > desenho > post-it com adesivo > resto — igual o pacote original
export function price(composition) {
  if (composition.elements.some((e) => e.kind === "photo")) return 12;
  if (composition.elements.some((e) => e.kind === "stroke")) return 10;
  if (composition.template === "note" && composition.elements.some((e) => e.kind === "sticker")) return 8;
  return 5;
}

const STICKER_IDS = new Set(STICKERS.map((s) => s.id));

// mesma validação do servidor original (tamanho, campos, tipos) — roda tanto no cliente
// (feedback rápido) quanto deve ser repetida no banco (nunca confiar só no cliente)
export function validateComposition(c) {
  if (!c || c.version !== 1 || !TEMPLATE_BY_ID[c.template] || !Array.isArray(c.elements) || c.elements.length > 80) {
    throw new Error("Composição inválida");
  }
  if (JSON.stringify(c).length > 8_000_000) throw new Error("Composição inválida");
  for (const e of c.elements) {
    if (!["text", "sticker", "photo", "decor", "stroke"].includes(e.kind)) throw new Error("Elemento inválido");
    if (!Number.isFinite(e.x) || e.x < 0 || e.x > 400) throw new Error("Elemento inválido");
    if (!Number.isFinite(e.y) || e.y < 0 || e.y > 500) throw new Error("Elemento inválido");
    if (!Number.isFinite(e.w) || e.w < 1 || e.w > 500) throw new Error("Elemento inválido");
    if (!Number.isFinite(e.rotation)) throw new Error("Elemento inválido");
    if (e.kind === "photo" && (!/^data:image\/(png|jpeg|webp);base64,/.test(e.content) || e.content.length > 7_000_000)) {
      throw new Error("Foto inválida");
    }
    if (e.kind === "sticker" && !STICKER_IDS.has(e.content)) throw new Error("Adesivo inválido");
    if (e.kind === "text" && e.content.length > 300) throw new Error("Texto muito longo");
  }
  if (!DURATIONS.includes(undefined)) { /* duração é validada à parte, por quem chama */ }
}

const svgns = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(svgns, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

// o template "base" por trás da composição: moldura do post-it, carinha do sorrisinho
// (de acordo com a expressão), placa — igual os paths fixos do Scene.tsx original
function templateArt(c) {
  if (c.template === "note") {
    return el("g", {}, [
      el("path", { d: "M54 72 H342 L324 426 H66 Z", fill: "#fff0af" }),
      el("path", { d: "M53 80 L143 55 M269 431 L344 410", stroke: "#d8bca0", "stroke-width": "23", opacity: ".7" }),
      el("path", { d: "M324 426 l-45 -5 46 -30", fill: "#efd47d" }),
    ]);
  }
  if (c.template === "smile") {
    const eyes = c.expression === "Sonolento" ? "M155 200 h15 M230 200 h15" : "M165 193 v12 M235 193 v12";
    const mouth = c.expression === "Surpreso" ? "M190 245 a15 20 0 1 0 30 0 a15 20 0 1 0 -30 0"
      : c.expression === "Engraçado" ? "M152 240 Q200 300 248 240 M200 276 v15"
      : "M152 240 Q200 302 248 240";
    const g = el("g", { fill: "none", stroke: "#533e36", "stroke-width": "9", "stroke-linecap": "round" }, [
      el("path", { d: eyes }), el("path", { d: mouth }),
    ]);
    if (c.expression === "Apaixonado") {
      const t = el("text", { x: "200", y: "155", "text-anchor": "middle", stroke: "none", fill: "#a94654", "font-size": "45" });
      t.textContent = "♥ ♥"; g.appendChild(t);
    }
    if (c.expression === "Animado") g.appendChild(el("path", { d: "M115 160 l-15 -15 M285 160 l15 -15" }));
    return g;
  }
  if (c.template === "sign") {
    return el("g", { fill: "none", stroke: "#533e36", "stroke-width": "3" }, [
      el("rect", { x: "35", y: "103", width: "330", height: "152", rx: "6" }),
      el("circle", { cx: "200", cy: "320", r: "35" }),
      el("path", { d: "M185 319 h2 M213 319 h2 M185 330 Q200 345 215 330 M200 355 v75 M200 380 L120 335 112 255 M200 380 L280 335 288 255 M200 430 l-40 48 M200 430 l40 48" }),
    ]);
  }
  return null;
}

function elementNode(e, opts) {
  const g = el("g", { transform: `translate(${e.x} ${e.y}) rotate(${e.rotation})`, "data-el-id": e.id, style: opts.interactive ? "cursor:grab;" : "" });
  if (opts.selectedId === e.id) {
    const h = e.kind === "sticker" || e.kind === "photo" ? e.w + 16 : 110;
    g.appendChild(el("rect", { x: -e.w / 2 - 8, y: -55, width: e.w + 16, height: h, fill: "none", stroke: "#c96044", "stroke-dasharray": "5 4" }));
  }
  if (e.kind === "text") {
    const fo = el("foreignObject", { x: -e.w / 2, y: -50, width: e.w, height: opts.template === "sign" ? 130 : 250 });
    const div = document.createElement("div");
    const size = Math.min(e.size, opts.template === "sign" ? 30 : 72);
    div.style.cssText = `font-family:${e.font};font-size:${size}px;color:${e.color};text-align:${e.align};white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.12;font-weight:700;`;
    div.textContent = e.content;
    fo.appendChild(div);
    g.appendChild(fo);
  } else if (e.kind === "sticker") {
    g.appendChild(el("image", { href: STICKER_SRC(e.content), x: -e.w / 2, y: -e.w / 2, width: e.w, height: e.w, preserveAspectRatio: "xMidYMid meet" }));
  } else if (e.kind === "photo") {
    const crop = e.crop || 1;
    const inner = el("svg", { x: -e.w / 2, y: -e.w / 2, width: e.w, height: e.w, viewBox: "0 0 100 100", overflow: "hidden" }, [
      el("image", { href: e.content, x: 50 - (100 * crop) / 2, y: 50 - (100 * crop) / 2, width: 100 * crop, height: 100 * crop, preserveAspectRatio: "xMidYMid slice" }),
    ]);
    g.appendChild(inner);
  } else if (e.kind === "decor") {
    const t = el("text", { "font-size": e.size, fill: e.color, "text-anchor": "middle" });
    t.textContent = e.content; g.appendChild(t);
  } else if (e.kind === "stroke") {
    g.appendChild(el("polyline", { points: (e.points || []).map((p) => p.join(",")).join(" "), fill: "none", stroke: e.color, "stroke-width": e.size, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  return g;
}

// renderiza a composição como um <svg> de verdade no DOM. Sem `opts.interactive`, é só
// visualização (prévia, recebimento, miniatura). Com `interactive`, liga os eventos de
// toque/mouse pra arrastar elemento (ou desenhar, se `opts.drawing`) — mesma lógica do
// Scene.tsx original, só que direto no DOM em vez de estado do React: durante o gesto
// (arrastar ou desenhar), move/desenha mexendo direto no nó SVG, sem chamar `onMove`/
// `onDraw` a cada pixel — só uma vez, no final (pointerup). Isso é importante: quem chama
// isso (app.js) costuma reagir a `onMove`/`onDraw` re-renderizando a tela, e trocar o
// <svg> no meio do gesto perderia o pointer capture e travaria o arrasto pela metade.
export function renderScene(composition, opts = {}) {
  const svg = el("svg", { viewBox: "0 0 400 500", class: "capi-scene", role: "img", "aria-label": "Composição da Capisurpresa" });
  svg.style.touchAction = opts.interactive && (opts.onMove || opts.drawing) ? "none" : "auto";
  svg.appendChild(el("rect", { width: 400, height: 500, rx: 24, fill: composition.background }));
  const art = templateArt(composition);
  if (art) svg.appendChild(art);
  for (const e of composition.elements) {
    const node = elementNode(e, { selectedId: opts.selectedId, template: composition.template, interactive: opts.interactive });
    if (opts.interactive) {
      node.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); startGesture(ev, svg, e, opts); });
    }
    svg.appendChild(node);
  }
  if (opts.interactive && opts.drawing) {
    svg.appendChild(el("polyline", { "data-live-stroke": "1", points: "", fill: "none", stroke: opts.drawColor || "#806451", "stroke-width": "3", "stroke-linecap": "round" }));
  }
  if (opts.interactive && (opts.onMove || opts.drawing)) {
    svg.addEventListener("pointerdown", (ev) => startGesture(ev, svg, null, opts));
  }
  return svg;
}

function scenePoint(ev, svg) {
  const r = svg.getBoundingClientRect();
  return [(ev.clientX - r.left) * 400 / r.width, (ev.clientY - r.top) * 500 / r.height];
}

function startGesture(ev, svg, targetEl, opts) {
  if (!opts.onMove && !opts.drawing) return;
  ev.preventDefault();
  opts.onGestureStart?.();
  const [x, y] = scenePoint(ev, svg);
  // em alguns navegadores/gestos (ex.: ponteiro já solto entre o down e aqui) isso pode
  // lançar NotFoundError — sem capturar, o arrasto só fica um pouco menos robusto se o
  // dedo sair da área do SVG no meio do gesto, mas não trava o gesto inteiro
  try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* segue sem captura */ }
  const gesture = { id: opts.drawing ? undefined : targetEl?.id, rotation: targetEl?.rotation || 0, dx: x - (targetEl?.x || 0), dy: y - (targetEl?.y || 0), points: [[x, y]], lastX: targetEl?.x || 0, lastY: targetEl?.y || 0 };
  if (targetEl && !opts.drawing) opts.onSelect?.(targetEl.id);
  const liveStroke = opts.drawing ? svg.querySelector("[data-live-stroke]") : null;
  const movedNode = gesture.id ? svg.querySelector(`[data-el-id="${gesture.id}"]`) : null;

  const onMove = (e2) => {
    const [px, py] = scenePoint(e2, svg);
    if (opts.drawing) {
      gesture.points.push([px, py]);
      liveStroke?.setAttribute("points", gesture.points.map((p) => p.join(",")).join(" "));
    } else if (gesture.id) {
      gesture.lastX = Math.max(20, Math.min(380, px - gesture.dx));
      gesture.lastY = Math.max(20, Math.min(480, py - gesture.dy));
      movedNode?.setAttribute("transform", `translate(${gesture.lastX} ${gesture.lastY}) rotate(${gesture.rotation})`);
    }
  };
  const onUp = () => {
    if (opts.drawing && gesture.points.length > 1) opts.onDraw?.(gesture.points);
    else if (gesture.id) opts.onMove?.(gesture.id, gesture.lastX, gesture.lastY);
    liveStroke?.setAttribute("points", "");
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", onUp);
    svg.removeEventListener("pointercancel", onUp);
  };
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
}
