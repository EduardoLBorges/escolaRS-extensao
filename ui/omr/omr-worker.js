/**
 * omr-worker.js — Web Worker para processamento de imagem OMR
 *
 * Sistema de Coordenadas (definitivo):
 *   - Os 4 fiduciais (TL, TR, BL, BR) detectados na imagem definem um
 *     quadrilátero de referência.
 *   - (u=0,v=0) = centro do fiducial TL
 *   - (u=1,v=0) = centro do fiducial TR
 *   - (u=0,v=1) = centro do fiducial BL
 *   - (u=1,v=1) = centro do fiducial BR
 *   - bilinearPoint(u,v) converte essas coordenadas normalizadas em
 *     pixels na imagem real (com correção de perspectiva).
 *   - O overlay dewarped (outW×outH) usa o MESMO sistema: pixel (px,py)
 *     corresponde a u=px/outW, v=py/outH.
 *   - As bolhas têm u,v calculados em relação aos centróides dos fiduciais
 *     no canvas lógico do gerador.
 */

'use strict';

self.onmessage = function (e) {
  const { imageData, width, height, _config, _manualFiducials } = e.data;
  self._pendingConfig = _config;
  self._manualFiducials = _manualFiducials || null;
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
  let sumB = 0, wB = 0, max = 0, threshold = 128;
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

// ─── 3. Detecção de Marcadores Fiduciais — QR Finder Pattern ─────────────────
//
// Algoritmo idêntico ao usado por leitores de QR Code reais:
//   A) Varredura horizontal: procura sequências preto→branco→preto→branco→preto
//      com ratio ≈ 1:1:3:1:1 (invariante à escala)
//   B) Verificação cruzada vertical: para cada candidato horizontal, verifica
//      se o mesmo ratio existe na direção vertical passando pelo centro.
//      Isso elimina >95% dos falsos positivos (texto, bordas, etc.)
//   C) Clustering: agrupa candidatos próximos com centróide ponderado
//   D) Seleciona os 4 que formam o melhor retângulo
//   E) Refina centróide com alta precisão
//
function detectFiducials(bin, w, h) {
  const minDim = Math.min(w, h);
  const RATIO_TOL = 0.55; // tolerância de ratio (45%-155% do esperado)

  // ── Função de verificação de ratio 1:1:3:1:1 ──────────────────────────────
  function checkRatio(r0, r1, r2, r3, r4) {
    const total = r0 + r1 + r2 + r3 + r4;
    if (total < 7) return false;
    const unit = total / 7;
    const ok = (val, expected) => {
      const ratio = val / (unit * expected);
      return ratio >= (1 - RATIO_TOL) && ratio <= (1 + RATIO_TOL);
    };
    return ok(r0, 1) && ok(r1, 1) && ok(r2, 3) && ok(r3, 1) && ok(r4, 1);
  }

  // ── A. Varredura Horizontal ────────────────────────────────────────────────
  // Percorre cada linha da imagem binarizada coletando "runs" (sequências de
  // mesma cor). Para cada janela de 5 runs que começa com PRETO e satisfaz
  // o ratio 1:1:3:1:1, registra o centro como candidato horizontal.
  const hCandidates = [];

  for (let y = 0; y < h; y++) {
    // Coleta runs desta linha: [{color, len, start}, ...]
    const runs = [];
    let start = 0;
    let color = bin[y * w];
    for (let x = 1; x < w; x++) {
      const px = bin[y * w + x];
      if (px !== color) {
        runs.push({ color, len: x - start, start });
        start = x;
        color = px;
      }
    }
    runs.push({ color, len: w - start, start });

    if (runs.length < 5) continue;

    for (let i = 0; i <= runs.length - 5; i++) {
      // O padrão começa com PRETO (cor 0)
      if (runs[i].color !== 0) continue;

      const r0 = runs[i].len, r1 = runs[i+1].len, r2 = runs[i+2].len;
      const r3 = runs[i+3].len, r4 = runs[i+4].len;

      if (checkRatio(r0, r1, r2, r3, r4)) {
        const total = r0 + r1 + r2 + r3 + r4;
        const cx = runs[i].start + r0 + r1 + r2 / 2;
        hCandidates.push({
          cx: Math.round(cx),
          cy: y,
          moduleSize: total / 7,
        });
      }
    }
  }

  if (hCandidates.length < 4) {
    throw new Error(`Padrão QR Finder horizontal não encontrado (${hCandidates.length}). Tente calibrar manualmente.`);
  }

  // ── B. Verificação Cruzada Vertical ────────────────────────────────────────
  // Para cada candidato horizontal, varre a coluna vertical no ponto cx
  // procurando o mesmo ratio 1:1:3:1:1. Só mantém candidatos verificados.
  const verified = [];

  for (const cand of hCandidates) {
    const x = cand.cx;
    if (x < 0 || x >= w) continue;

    // Coleta runs verticais na coluna x
    const runs = [];
    let start = 0;
    let color = bin[x]; // pixel (x, 0)
    for (let y = 1; y < h; y++) {
      const px = bin[y * w + x];
      if (px !== color) {
        runs.push({ color, len: y - start, start });
        start = y;
        color = px;
      }
    }
    runs.push({ color, len: h - start, start });

    // Procura a janela de 5 runs que contém cy
    let found = false;
    for (let i = 0; i <= runs.length - 5; i++) {
      if (runs[i].color !== 0) continue;

      const r0 = runs[i].len, r1 = runs[i+1].len, r2 = runs[i+2].len;
      const r3 = runs[i+3].len, r4 = runs[i+4].len;

      if (!checkRatio(r0, r1, r2, r3, r4)) continue;

      // Centro vertical do padrão encontrado
      const cy = runs[i].start + r0 + r1 + r2 / 2;

      // Verifica se o centro vertical está próximo do candidato horizontal
      const dist = Math.abs(cy - cand.cy);
      const total = r0 + r1 + r2 + r3 + r4;
      const moduleV = total / 7;

      if (dist < moduleV * 4) { // tolerância: 4 módulos de diferença
        const avgModule = (cand.moduleSize + moduleV) / 2;
        verified.push({
          cx: cand.cx,
          cy: Math.round((cand.cy + cy) / 2), // média dos centros H e V
          moduleSize: avgModule,
          scale: Math.round(avgModule * 3.5),
        });
        found = true;
        break;
      }
    }
  }

  if (verified.length < 4) {
    throw new Error(`Verificação cruzada falhou (${verified.length} marcadores confirmados). Tente calibrar manualmente.`);
  }

  // ── C. Clustering com centróide ponderado ──────────────────────────────────
  // Agrupa candidatos verificados que estão próximos e calcula centróide médio.
  const clusterRadius = Math.max(15, Math.round(minDim * 0.03));
  const clusters = [];
  const clusterUsed = new Uint8Array(verified.length);

  for (let i = 0; i < verified.length; i++) {
    if (clusterUsed[i]) continue;
    let sumX = verified[i].cx;
    let sumY = verified[i].cy;
    let sumM = verified[i].moduleSize;
    let count = 1;
    clusterUsed[i] = 1;

    for (let j = i + 1; j < verified.length; j++) {
      if (clusterUsed[j]) continue;
      const dx = verified[i].cx - verified[j].cx;
      const dy = verified[i].cy - verified[j].cy;
      if (dx * dx + dy * dy < clusterRadius * clusterRadius) {
        sumX += verified[j].cx;
        sumY += verified[j].cy;
        sumM += verified[j].moduleSize;
        count++;
        clusterUsed[j] = 1;
      }
    }
    clusters.push({
      cx: Math.round(sumX / count),
      cy: Math.round(sumY / count),
      moduleSize: sumM / count,
      scale: Math.round((sumM / count) * 3.5),
      votes: count, // mais votos = mais confiável
    });
  }

  if (clusters.length < 4) {
    throw new Error(`Poucos marcadores distintos (${clusters.length}). Tente calibrar manualmente.`);
  }

  // Ordena por número de votos (mais confirmações = mais confiável)
  clusters.sort((a, b) => b.votes - a.votes);
  const kept = clusters.slice(0, Math.min(clusters.length, 12));

  // ── D. Melhor retângulo entre as combinações C(N,4) ───────────────────────
  const topN = kept.length;
  let bestScore = -Infinity;
  let bestQuad = null;

  for (let a = 0; a < topN - 3; a++) {
    for (let b = a + 1; b < topN - 2; b++) {
      for (let c = b + 1; c < topN - 1; c++) {
        for (let d = c + 1; d < topN; d++) {
          const pts = [kept[a], kept[b], kept[c], kept[d]];

          // Ordena pelo ângulo ao redor do centróide
          const mcx = (pts[0].cx + pts[1].cx + pts[2].cx + pts[3].cx) / 4;
          const mcy = (pts[0].cy + pts[1].cy + pts[2].cy + pts[3].cy) / 4;
          pts.sort((p, q) =>
            Math.atan2(p.cy - mcy, p.cx - mcx) - Math.atan2(q.cy - mcy, q.cx - mcx)
          );
          // Após sort por ângulo (−π a +π): TL, TR, BR, BL
          const quad = { tl: pts[0], tr: pts[1], br: pts[2], bl: pts[3] };

          const wTop   = Math.hypot(quad.tr.cx - quad.tl.cx, quad.tr.cy - quad.tl.cy);
          const wBot   = Math.hypot(quad.br.cx - quad.bl.cx, quad.br.cy - quad.bl.cy);
          const hLeft  = Math.hypot(quad.bl.cx - quad.tl.cx, quad.bl.cy - quad.tl.cy);
          const hRight = Math.hypot(quad.br.cx - quad.tr.cx, quad.br.cy - quad.tr.cy);
          const d1     = Math.hypot(quad.br.cx - quad.tl.cx, quad.br.cy - quad.tl.cy);
          const d2     = Math.hypot(quad.bl.cx - quad.tr.cx, quad.bl.cy - quad.tr.cy);

          const avgW = (wTop + wBot) / 2;
          const avgH = (hLeft + hRight) / 2;
          const area = avgW * avgH;

          if (area < minDim * minDim * 0.002) continue; // muito pequeno → ignora

          const parallelScore = 1 - (Math.abs(wTop - wBot) + Math.abs(hLeft - hRight)) / (avgW + avgH + 1);
          const diagScore     = 1 - Math.abs(d1 - d2) / ((d1 + d2) / 2 + 1);
          const voteScore     = pts.reduce((s, p) => s + (p.votes || 1), 0) / 4;
          const sizeBonus     = Math.log(area + 1) * 0.001;

          const score = parallelScore * 0.40 + diagScore * 0.30 + Math.min(voteScore * 0.02, 0.20) + sizeBonus;

          if (score > bestScore) { bestScore = score; bestQuad = quad; }
        }
      }
    }
  }

  if (!bestQuad || bestScore < 0.15) {
    throw new Error('Não foi possível identificar os 4 marcadores. Tente calibrar manualmente.');
  }

  // ── E. Refina centróide na imagem original ────────────────────────────────
  // Para cada marcador QR finder, encontra o centróide de TODOS os pixels pretos
  // dentro de uma janela proporcional ao moduleSize detectado.
  const refine = ({ cx, cy, moduleSize }) => {
    const halfSize = Math.round((moduleSize || 10) * 4.5); // janela = ~9 módulos
    const x0 = Math.max(0, cx - halfSize);
    const y0 = Math.max(0, cy - halfSize);
    const x1 = Math.min(w, cx + halfSize);
    const y1 = Math.min(h, cy + halfSize);

    let sx = 0, sy = 0, count = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (bin[py * w + px] === 0) { sx += px; sy += py; count++; }
      }
    }
    return count > 0 ? { x: sx / count, y: sy / count } : { x: cx, y: cy };
  };

  return [
    refine(bestQuad.tl),
    refine(bestQuad.tr),
    refine(bestQuad.bl),
    refine(bestQuad.br),
  ];
}



// ─── 4. Interpolação Bilinear ────────────────────────────────────────────────

// (u,v) ∈ [0,1]² → pixel na imagem real, corrigindo distorção de perspectiva.
// u=0,v=0 = TL; u=1,v=0 = TR; u=0,v=1 = BL; u=1,v=1 = BR
function bilinearPoint(u, v, tl, tr, bl, br) {
  return {
    x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x,
    y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y,
  };
}

// ─── 5. Amostragem de Densidade de Bolha ─────────────────────────────────────
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

// ─── 6. Mapa de Coordenadas das Bolhas (normalizadas aos fiduciais) ────────────
//
// O gerador posiciona os fiduciais em:
//   TL centro: (xFidL, yRow0)
//   TR centro: (xFidR, yRow0)
//   BL centro: (xFidL, yRowLast)
//   BR centro: (xFidR, yRowLast)
//
// Portanto a normalização correta para uma bolha em (bx, by) é:
//   u = (bx - xFidL) / (xFidR - xFidL)
//   v = (by - yRow0) / (yRowLast - yRow0)
//
// Se yRow0 === yRowLast (só 1 questão), spanY = 0 → v = 0.5 (centro).
function buildBubbleMap(config) {
  const FID_SIZE  = 14;
  const FID_INSET = 10;
  const ROW_H     = 22;
  const Q_W       = 24;
  const BUB_R     = 7.5;
  const BUB_SP    = 22;
  const COL_GAP   = 26;

  const numQuestoes  = config.numQuestoes  || 20;
  const alternativas = config.alternativas || 'ABCDE';
  const colunas      = config.colunas      || 1;
  const titulo       = config.titulo       || '';

  const nOpts   = alternativas.length;
  const qPorCol = Math.ceil(numQuestoes / colunas);

  const titlePresent = titulo && titulo.trim().length > 0;
  const headerH = titlePresent ? 24 : 14;

  // ── Reproduz exatamente as constantes do gerador.js ────────────────────────
  const xFidL = FID_INSET + FID_SIZE / 2;                   // 17
  const contentL = xFidL + FID_SIZE / 2 + 10;               // 34
  const colContentW = Q_W + nOpts * BUB_SP;
  const totalContentW = colunas * colContentW + (colunas - 1) * COL_GAP;
  const contentR = contentL + totalContentW;
  const xFidR = contentR + 10 + FID_SIZE / 2;

  const yRow0    = FID_INSET + headerH;
  const yRowLast = yRow0 + Math.max(1, qPorCol - 1) * ROW_H;

  // ── Spans (espaço entre centróides dos fiduciais no canvas lógico) ─────────
  const spanX = xFidR - xFidL;                              // largura lógica entre fiduciais
  const spanY = yRowLast - yRow0;                            // altura lógica entre fiduciais

  const altLabels = alternativas.split('');
  const bubbles = [];

  for (let q = 0; q < numQuestoes; q++) {
    const col = Math.floor(q / qPorCol);
    const row = q % qPorCol;

    const ox = contentL + col * (colContentW + COL_GAP);
    const oy = yRow0 + row * ROW_H;

    altLabels.forEach((alt, i) => {
      const bx = ox + Q_W + BUB_SP * 0.5 + i * BUB_SP;
      const by = oy;

      // Normaliza em relação aos centróides dos fiduciais
      const u = (bx - xFidL) / spanX;
      const v = spanY > 0 ? (by - yRow0) / spanY : 0.5;

      bubbles.push({ questao: q + 1, opcao: alt, u, v });
    });
  }

  // Raio de amostragem: BUB_R como fração do spanX
  const sampleRadiusRatio = BUB_R / spanX;

  return { bubbles, sampleRadiusRatio, spanX, spanY };
}

// ─── 7. Decisão de Resposta ───────────────────────────────────────────────────
function decideAnswers(densities, numQuestoes) {
  const results = [];

  for (let q = 1; q <= numQuestoes; q++) {
    const row = densities
      .filter(d => d.questao === q)
      .sort((a, b) => b.density - a.density);

    if (!row.length) continue;

    const top    = row[0];
    const second = row[1];
    const minD   = row[row.length - 1].density;

    // Uma bolha é "marcada" se:
    //   - densidade >= 35%, E
    //   - pelo menos 18pp acima do mínimo da linha (bolha mais limpa)
    const marked = row.filter(d =>
      d.density >= 0.35 && (d.density - minD) >= 0.18
    );

    const conf = top && second ? top.density - second.density : (top ? top.density : 0);

    let resposta = null, status = 'branco';
    if (marked.length > 1)     { status = 'anulada'; }
    else if (marked.length === 1) { resposta = marked[0].opcao; status = 'ok'; }

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

  let tl, tr, bl, br;
  if (self._manualFiducials) {
    // Usa os cantos selecionados manualmente pelo usuário — pula auto-detecção
    ({ tl, tr, bl, br } = self._manualFiducials);
    self.postMessage({ progress: 55, status: 'Usando cantos manuais...' });
  } else {
    [tl, tr, bl, br] = detectFiducials(bin, w, h);
  }

  const config = self._pendingConfig || {};

  self.postMessage({ progress: 65, status: 'Mapeando bolhas...' });
  const { bubbles, sampleRadiusRatio } = buildBubbleMap(config);

  // Raio em pixels: proporcional à distância real entre os fiduciais TL→TR
  const fidDistX = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const rPx = Math.max(4, sampleRadiusRatio * fidDistX);


  self.postMessage({ progress: 80, status: 'Amostrando bolhas...' });
  const densities = bubbles.map(({ questao, opcao, u, v }) => {
    const { x, y } = bilinearPoint(u, v, tl, tr, bl, br);
    const density = sampleBubble(bin, w, h, x, y, rPx);
    return { questao, opcao, density, u, v, x, y };
  });

  self.postMessage({ progress: 92, status: 'Analisando respostas...' });
  const answers = decideAnswers(densities, config.numQuestoes || 20);

  // ── Dewarped overlay (400×500px) ─────────────────────────────────────────────
  // O canvas dewarped mapeia (px/outW, py/outH) → bilinear com TL/TR/BL/BR.
  // Isso "estica" a imagem para que os 4 fiduciais fiquem nos 4 cantos do canvas.
  // As coordenadas (u,v) das bolhas podem ser desenhadas diretamente como
  // (u*outW, v*outH) SOMENTE se o canvas dewarped usar o mesmo span.
  // Como usamos u/v relativos ao span entre fiduciais, precisamos aplicar
  // o mesmo mapeamento no overlay.
  const outW = 400, outH = 500;
  const outData = new Uint8ClampedArray(outW * outH * 4);

  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      // u,v ∈ [0,1] → mapeados ao quadrilátero dos fiduciais
      const u = px / outW;
      const v = py / outH;
      const { x, y } = bilinearPoint(u, v, tl, tr, bl, br);
      const sx = Math.round(x), sy = Math.round(y);
      const di = (py * outW + px) * 4;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        const si = (sy * w + sx) * 4;
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
    fidDistX,
    sampleRadiusRatio,
  };
}
