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

// ─── 3. Detecção de Marcadores Fiduciais ──────────────────────────────────────
//
// Estratégia robusta em 5 fases:
//   A) Mapa de densidade downscalado (4×) para velocidade
//   B) Varredura global com sliding window multi-escala → lista de candidatos
//   C) Non-maximum suppression → top candidatos distintos
//   D) Seleciona os 4 candidatos que formam o melhor retângulo
//   E) Refina centróide de cada marcador na imagem original (alta resolução)
//
// Funciona independentemente de onde o bloco OMR esteja na foto.
function detectFiducials(bin, w, h) {
  const minDim = Math.min(w, h);

  // ── A. Mapa de densidade (downscale 4×) ────────────────────────────────────
  const DS = 4;
  const dw = Math.floor(w / DS);
  const dh = Math.floor(h / DS);
  const densMap = new Float32Array(dw * dh);

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      let black = 0;
      for (let ky = 0; ky < DS; ky++) {
        for (let kx = 0; kx < DS; kx++) {
          if (bin[(dy * DS + ky) * w + (dx * DS + kx)] === 0) black++;
        }
      }
      densMap[dy * dw + dx] = black / (DS * DS);
    }
  }

  // ── B. Pontuação Bullseye global ───────────────────────────────────────────
  // Bullseye score = preto_interno × (1 - branco_gap) × preto_externo
  //
  // Proporções do gerador (em px lógicos):
  //   OUTER=10, MID=6, INNER=3 → escala para imagem via ratio
  //
  // Varremos a imagem downscalada com 3 escalas de janela para cobrir variações
  // de tamanho (bloco pequeno ou grande na foto).
  const candidates = [];

  // Tentamos 3 tamanhos de "outer_radius" relativos à menor dimensão
  const OUTER_FRACS = [0.018, 0.035, 0.06, 0.09]; // fração de minDim para outer_r

  for (const frac of OUTER_FRACS) {
    const outerR = Math.max(4, Math.round(minDim * frac));
    const midR   = Math.round(outerR * 6 / 10);   // proporção: 6/10 do outer
    const innerR = Math.round(outerR * 3 / 10);   // proporção: 3/10 do outer

    // No mapa downscalado
    const outerDs  = Math.max(1, Math.round(outerR / DS));
    const midDs    = Math.max(1, Math.round(midR   / DS));
    const innerDs  = Math.max(1, Math.round(innerR / DS));

    // Função auxiliar: densidade média numa janela quadrada centrada em (cx,cy) no mapa ds
    const boxDens = (cx, cy, r) => {
      let sum = 0, cnt = 0;
      for (let ky = -r; ky <= r; ky++) {
        for (let kx = -r; kx <= r; kx++) {
          const px = cx + kx, py = cy + ky;
          if (px >= 0 && px < dw && py >= 0 && py < dh) { sum += densMap[py * dw + px]; cnt++; }
        }
      }
      return cnt > 0 ? sum / cnt : 0;
    };

    for (let dy = outerDs; dy < dh - outerDs; dy++) {
      for (let dx = outerDs; dx < dw - outerDs; dx++) {
        const dOuter = boxDens(dx, dy, outerDs);
        const dMid   = boxDens(dx, dy, midDs);
        const dInner = boxDens(dx, dy, innerDs);

        // Assinatura bullseye: centro preto, anel branco, borda preta
        // score = dInner * (1 - dMid_anel) * dOuter_anel
        // dMid_anel = densidade SÓ no anel entre innerDs e midDs (aproximado)
        const midRingDens  = Math.max(0, (dMid  - dInner) / (1 - dInner + 0.01));
        const outerRingDens = Math.max(0, (dOuter - dMid)   / (1 - dMid + 0.01));

        const score = dInner * (1 - midRingDens) * outerRingDens;

        if (score >= 0.08) {  // threshold mínimo para evitar ruído
          candidates.push({
            cx: dx * DS,
            cy: dy * DS,
            density: score,   // reuso do campo "density" para o score bullseye
            scale: outerR,    // escala estimada para refino posterior
          });
        }
      }
    }
  }

  if (candidates.length < 4) {
    throw new Error(`Marcadores bullseye não encontrados (${candidates.length} candidatos). Tente calibrar manualmente.`);
  }

  // ── C. Non-maximum suppression ────────────────────────────────────────────
  const suppRadius = WIN_MAX;
  candidates.sort((a, b) => b.density - a.density);

  const kept = [];
  const used = new Uint8Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    if (used[i]) continue;
    kept.push(candidates[i]);
    for (let j = i + 1; j < candidates.length; j++) {
      if (used[j]) continue;
      const dx = candidates[i].cx - candidates[j].cx;
      const dy = candidates[i].cy - candidates[j].cy;
      if (dx * dx + dy * dy < suppRadius * suppRadius) used[j] = 1;
    }
    if (kept.length >= 16) break;
  }

  if (kept.length < 4) {
    throw new Error(`Poucos marcadores distintos (${kept.length}). Tente calibrar manualmente.`);
  }

  // ── D. Melhor retângulo entre as combinações C(N,4) ───────────────────────
  const topN = Math.min(kept.length, 12);
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

          if (area < minDim * minDim * 0.004) continue; // muito pequeno → ignora

          const parallelScore = 1 - (Math.abs(wTop - wBot) + Math.abs(hLeft - hRight)) / (avgW + avgH + 1);
          const diagScore     = 1 - Math.abs(d1 - d2) / ((d1 + d2) / 2 + 1);
          const densScore     = pts.reduce((s, p) => s + p.density, 0) / 4;
          const sizeBonus     = Math.log(area + 1) * 0.001;

          const score = parallelScore * 0.45 + diagScore * 0.30 + densScore * 0.25 + sizeBonus;

          if (score > bestScore) { bestScore = score; bestQuad = quad; }
        }
      }
    }
  }

  if (!bestQuad || bestScore < 0.25) {
    throw new Error('Não foi possível identificar os 4 marcadores. Tente calibrar manualmente.');
  }

  // ── E. Refina centróide na imagem original ────────────────────────────────
  // Usa a escala estimada do candidato para janela de refino proporcional.
  // Considera apenas os pixels pretos que NÃO estão no anel branco central
  // (usa uma janela do tamanho do anel externo: outerR e exclui a região midR).
  const avgScale = (bestQuad.tl.scale + bestQuad.tr.scale + bestQuad.bl.scale + bestQuad.br.scale) / 4;
  const refineOuter = Math.round(avgScale * 1.4);
  const refineMid   = Math.round(avgScale * 0.6 / 1.0); // zona branca a excluir

  const refine = ({ cx, cy }) => {
    const x0 = Math.max(0, Math.round(cx - refineOuter));
    const y0 = Math.max(0, Math.round(cy - refineOuter));
    const x1 = Math.min(w, Math.round(cx + refineOuter));
    const y1 = Math.min(h, Math.round(cy + refineOuter));
    let sx = 0, sy = 0, count = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        // Só conta pixels no ANEL EXTERNO (exclui a zona branca central)
        const dr2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (dr2 < refineMid * refineMid) continue; // zona branca: pula
        if (bin[py * w + px] === 0) { sx += px; sy += py; count++; }
      }
    }
    // Se não achou pixels no anel externo, tenta centróide de todos os pretos
    if (!count) {
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (bin[py * w + px] === 0) { sx += px; sy += py; count++; }
        }
      }
    }
    return count ? { x: sx / count, y: sy / count } : { x: cx, y: cy };
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
