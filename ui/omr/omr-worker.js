/**
 * omr-worker.js — Web Worker para processamento de imagem OMR
 *
 * Pipeline:
 *   1. Escala de Cinza
 *   2. Binarização (Otsu Threshold)
 *   3. Detecção dos 4 Marcadores Fiduciais
 *   4. Correção de Perspectiva (Interpolação Bilinear)
 *   5. Leitura de Metadados (rodapé com texto OMR:q=N:a=ABCDE:c=N)
 *   6. Amostragem das Bolhas
 *   7. Decisão de Resposta por Questão
 */

'use strict';

self.onmessage = function (e) {
  const { imageData, width, height, _config } = e.data;
  // Armazena config recebido para uso nas funções internas
  self._pendingConfig = _config;
  try {
    const result = processOMR(imageData, width, height);
    self.postMessage({ success: true, ...result });
  } catch (err) {
    self.postMessage({ success: false, error: err.message });
  }
};

// ─── 1. Escala de Cinza ───────────────────────────────────────────────────────
function toGrayscale(data, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return gray;
}

// ─── 2. Binarização (Otsu) ────────────────────────────────────────────────────
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;

  let sumB = 0, wB = 0, max = 0, threshold = 0;
  let sum1 = 0;
  for (let i = 0; i < 256; i++) sum1 += i * hist[i];

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum1 - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

function binarize(gray, threshold) {
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] < threshold ? 0 : 255;
  return bin;
}

// ─── 3. Detecção de Marcadores Fiduciais ──────────────────────────────────────
// Busca o centróide do maior cluster de pixels pretos em cada quadrante de canto.
function detectFiducials(bin, w, h) {
  const qs = 0.15; // fração de busca em cada canto (15% da dimensão)
  const qW = Math.floor(w * qs);
  const qH = Math.floor(h * qs);

  const corners = [
    { x0: 0,      y0: 0,      x1: qW,   y1: qH   },   // TL
    { x0: w - qW, y0: 0,      x1: w,    y1: qH   },   // TR
    { x0: 0,      y0: h - qH, x1: qW,   y1: h    },   // BL
    { x0: w - qW, y0: h - qH, x1: w,    y1: h    },   // BR
  ];

  return corners.map(({ x0, y0, x1, y1 }) => {
    let sx = 0, sy = 0, count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (bin[y * w + x] === 0) { sx += x; sy += y; count++; }
      }
    }
    if (!count) throw new Error('Marcador fiducial não encontrado. Verifique a foto e tente novamente.');
    return { x: sx / count, y: sy / count };
  });
}

// ─── 4. Interpolação Bilinear (amostragem com correção de perspectiva) ────────
// Dado os 4 pontos fiduciais (TL, TR, BL, BR), transforma coordenadas
// normalizadas (u,v) em coordenadas de pixel na imagem original.
function bilinearPoint(u, v, tl, tr, bl, br) {
  return {
    x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x,
    y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y,
  };
}

// ─── 5. Amostragem de Densidade de Bolha ─────────────────────────────────────
// Calcula a porcentagem de pixels pretos dentro de um raio R ao redor de (cx,cy).
function sampleBubble(bin, w, h, cx, cy, r) {
  let total = 0, black = 0;
  const ir = Math.ceil(r);
  for (let dy = -ir; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(cx + dx);
      const py = Math.round(cy + dy);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      total++;
      if (bin[py * w + px] === 0) black++;
    }
  }
  return total > 0 ? black / total : 0;
}

// ─── 6. Mapa de Coordenadas das Bolhas ───────────────────────────────────────
// Reconstrói as coordenadas normalizadas de cada bolha com base nos metadados
// do gerador (mesmas constantes de layout do gerador.js).
function buildBubbleMap(config, imageW, imageH) {
  // Constantes espelhadas do gerador.js (layout compacto)
  const FID_SIZE  = 14;
  const FID_INSET = 10;
  const ROW_H     = 22;
  const Q_W       = 24;
  const BUB_R     = 7.5;
  const BUB_SP    = 22;
  const COL_GAP   = 26;

  const { numQuestoes, alternativas, colunas, titulo } = config;
  const nOpts   = alternativas.length;
  const qPorCol = Math.ceil(numQuestoes / colunas);

  const titlePresent = titulo && titulo.trim().length > 0;
  const headerH = titlePresent ? 24 : 14;

  const xFidL = FID_INSET + FID_SIZE / 2;
  const contentL = xFidL + FID_SIZE / 2 + 10;

  const colContentW = Q_W + nOpts * BUB_SP;
  const totalContentW = colunas * colContentW + (colunas - 1) * COL_GAP;
  const contentR = contentL + totalContentW;

  const xFidR = contentR + 10 + FID_SIZE / 2;
  const refW = xFidR + FID_SIZE / 2 + FID_INSET;

  const yRow0 = FID_INSET + headerH;
  const yRowLast = yRow0 + Math.max(1, qPorCol - 1) * ROW_H;
  const refH = yRowLast + FID_SIZE / 2 + 10;

  const altLabels = alternativas.split('');
  const bubbles = []; // { questao (1-based), opcao (A/B/...), u, v }

  for (let q = 0; q < numQuestoes; q++) {
    const col = Math.floor(q / qPorCol);
    const row = q % qPorCol;

    const ox = contentL + col * (colContentW + COL_GAP);
    const oy = yRow0 + row * ROW_H;

    altLabels.forEach((alt, i) => {
      const bx = ox + Q_W + BUB_SP * 0.5 + i * BUB_SP;
      const by = oy;
      bubbles.push({ questao: q + 1, opcao: alt, u: bx / refW, v: by / refH });
    });
  }

  return { bubbles, sampleRadius: BUB_R / refW }; // raio normalizado
}

// ─── 7. Decisão de Resposta ───────────────────────────────────────────────────
const THRESHOLD_MARKED  = 0.45; // densidade > 45% → marcada
const THRESHOLD_EMPTY   = 0.15; // densidade < 15% → vazia
const MIN_CONFIDENCE    = 0.20; // diferença mínima entre 1º e 2º para alta confiança

function decideAnswers(densities, numQuestoes, alternativas) {
  const altLabels = alternativas.split('');
  const results = [];

  for (let q = 1; q <= numQuestoes; q++) {
    const row = densities.filter(d => d.questao === q).sort((a, b) => b.density - a.density);

    const marked = row.filter(d => d.density > THRESHOLD_MARKED);
    const top    = row[0];
    const second = row[1];
    const conf   = top && second ? top.density - second.density : top ? top.density : 0;

    let resposta = null, status = 'branco';
    if (marked.length > 1) {
      status = 'anulada';
    } else if (marked.length === 1) {
      resposta = marked[0].opcao;
      status = 'ok';
    }

    results.push({ questao: q, resposta, status, confidence: conf, densities: row });
  }
  return results;
}

// ─── Processamento Principal ──────────────────────────────────────────────────
function processOMR(imageData, w, h) {
  self.postMessage({ progress: 10, status: 'Convertendo para escala de cinza...' });
  const gray = toGrayscale(imageData, w, h);

  self.postMessage({ progress: 25, status: 'Binarizando imagem (Otsu)...' });
  const thresh = otsuThreshold(gray);
  const bin = binarize(gray, thresh);

  self.postMessage({ progress: 40, status: 'Detectando marcadores fiduciais...' });
  const [tl, tr, bl, br] = detectFiducials(bin, w, h);

  self.postMessage({ progress: 55, status: 'Lendo metadados do rodapé...' });
  // Os metadados (q, a, c) são recebidos junto com a mensagem pelo leitor.js
  // Nesta versão, o config é passado via postMessage pelo orquestrador.
  // (campo config injetado pelo leitor.js antes de chamar o worker)
  const config = self._pendingConfig;

  self.postMessage({ progress: 70, status: 'Mapeando bolhas...' });
  const { bubbles, sampleRadius } = buildBubbleMap(config, w, h);

  self.postMessage({ progress: 80, status: 'Amostrando bolhas...' });
  const rPx = sampleRadius * Math.min(w, h); // raio em pixels da imagem real

  const densities = bubbles.map(({ questao, opcao, u, v }) => {
    const { x, y } = bilinearPoint(u, v, tl, tr, bl, br);
    const density = sampleBubble(bin, w, h, x, y, rPx);
    return { questao, opcao, density, x, y };
  });

  self.postMessage({ progress: 92, status: 'Analisando respostas...' });
  const answers = decideAnswers(densities, config.numQuestoes, config.alternativas);

  // Monta ImageData "desentortada" para overlay no leitor
  // (recorte bilinear normalizado em 400×500px)
  const outW = 400, outH = 500;
  const outData = new Uint8ClampedArray(outW * outH * 4);

  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      const u = px / outW;
      const v = py / outH;
      const { x, y } = bilinearPoint(u, v, tl, tr, bl, br);
      const sx = Math.round(x), sy = Math.round(y);
      const si = (sy * w + sx) * 4;
      const di = (py * outW + px) * 4;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        outData[di]   = imageData[si];
        outData[di+1] = imageData[si+1];
        outData[di+2] = imageData[si+2];
        outData[di+3] = 255;
      } else {
        outData[di+3] = 0;
      }
    }
  }

  return {
    answers,
    densities,
    dewarpedImageData: outData,
    dewarpedWidth: outW,
    dewarpedHeight: outH,
    fiducials: { tl, tr, bl, br },
  };
}
