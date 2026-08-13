/**
 * gerador.js — Gerador de Grade de Respostas (OMR Bubble Sheet)
 * Renderiza o bloco de respostas em um <canvas> e permite export em PNG.
 *
 * Layout do Canvas:
 *   ┌─[■]──────────────────────[■]─┐  ← Marcadores fiduciais (cantos)
 *   │  [Título/Rótulo]              │  ← Cabeçalho
 *   │  Q01  ○A  ○B  ○C  ○D  ○E    │  ← Grade de questões
 *   │  ...                          │
 *   │  [metadados: q:20,a:ABCDE]   │  ← Rodapé com metadados para o leitor
 *   └─[■]──────────────────────[■]─┘
 */

'use strict';

// ─── Constantes de Layout ────────────────────────────────────────────────────
const FID_SIZE  = 14;   // Tamanho do marcador fiducial (px)
const FID_INSET = 10;   // Margem da borda ao centro do marcador
const ROW_H     = 22;   // Altura compacta por linha de questão
const Q_W       = 24;   // Largura da coluna do número da questão
const BUB_R     = 7.5;  // Raio das bolhas
const BUB_SP    = 22;   // Espaçamento centro-a-centro entre bolhas
const COL_GAP   = 26;   // Espaço entre colunas

// ─── Cálculo de Dimensões do Canvas ──────────────────────────────────────────
function calcDimensions(config) {
  const { numQuestoes, alternativas, colunas, titulo } = config;
  const nOpts = alternativas.length;
  const qPorCol = Math.ceil(numQuestoes / colunas);

  const titlePresent = titulo && titulo.trim().length > 0;
  const headerH = titlePresent ? 24 : 14;

  // X dos Marcadores e Conteúdo
  const xFidL = FID_INSET + FID_SIZE / 2;
  const contentL = xFidL + FID_SIZE / 2 + 10;

  const colContentW = Q_W + nOpts * BUB_SP;
  const totalContentW = colunas * colContentW + (colunas - 1) * COL_GAP;
  const contentR = contentL + totalContentW;

  const xFidR = contentR + 10 + FID_SIZE / 2;
  const W = xFidR + FID_SIZE / 2 + FID_INSET;

  // Y da Primeira e Última Linha
  const yRow0 = FID_INSET + headerH;
  const yRowLast = yRow0 + Math.max(1, qPorCol - 1) * ROW_H;

  const H = yRowLast + FID_SIZE / 2 + 10;

  return { W, H, qPorCol, colContentW, xFidL, xFidR, contentL, yRow0, yRowLast, headerH };
}

// ─── Renderização Principal ───────────────────────────────────────────────────
function renderGrade(canvas, config) {
  const { numQuestoes, alternativas, colunas, escala, titulo } = config;
  const dim = calcDimensions(config);
  const { W, H, qPorCol, colContentW, xFidL, xFidR, contentL, yRow0, yRowLast } = dim;

  // Configura o canvas com escala
  canvas.width  = W * escala;
  canvas.height = H * escala;
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(escala, 0, 0, escala, 0, 0);

  // ── Fundo branco e Borda ──────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Marcadores Fiduciais (Alinhados na altura de yRow0 e yRowLast) ────────
  const fidPositions = [
    [xFidL - FID_SIZE / 2, yRow0 - FID_SIZE / 2],    // TL
    [xFidR - FID_SIZE / 2, yRow0 - FID_SIZE / 2],    // TR
    [xFidL - FID_SIZE / 2, yRowLast - FID_SIZE / 2], // BL
    [xFidR - FID_SIZE / 2, yRowLast - FID_SIZE / 2], // BR
  ];

  ctx.fillStyle = '#ffffff';
  fidPositions.forEach(([fx, fy]) => {
    ctx.fillRect(fx - 2, fy - 2, FID_SIZE + 4, FID_SIZE + 4);
  });

  ctx.fillStyle = '#000000';
  fidPositions.forEach(([fx, fy]) => {
    ctx.fillRect(fx, fy, FID_SIZE, FID_SIZE);
  });

  // ── Cabeçalho (Opcional) ──────────────────────────────────────────────────
  if (titulo && titulo.trim()) {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(titulo.trim(), W / 2, FID_INSET + 10);
  }

  // ── Grade de Questões ─────────────────────────────────────────────────────
  const altLabels = alternativas.split('');

  ctx.textBaseline = 'middle';

  for (let q = 0; q < numQuestoes; q++) {
    const col = Math.floor(q / qPorCol);
    const row = q % qPorCol;

    const ox = contentL + col * (colContentW + COL_GAP);
    const oy = yRow0 + row * ROW_H;

    // Número da questão
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(q + 1).padStart(2, '0'), ox + Q_W - 4, oy);

    // Bolhas
    altLabels.forEach((alt, i) => {
      const bx = ox + Q_W + BUB_SP * 0.5 + i * BUB_SP;
      const by = oy;

      // Círculo vazio
      ctx.beginPath();
      ctx.arc(bx, by, BUB_R, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // Letra dentro da bolha
      ctx.fillStyle = '#555555';
      ctx.font = '7px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(alt, bx, by + 0.5);
    });
  }
}

// ─── UI: Exportação ───────────────────────────────────────────────────────────
function getConfig() {
  return {
    numQuestoes  : parseInt(document.getElementById('cfgQuestoes').value, 10),
    alternativas : document.getElementById('cfgAlternativas').value,
    colunas      : parseInt(document.querySelector('input[name="cfgColunas"]:checked').value, 10),
    escala       : parseInt(document.getElementById('cfgEscala').value, 10),
    titulo       : document.getElementById('cfgTitulo').value,
  };
}

function downloadPNG() {
  const canvas = document.getElementById('gradeCanvas');
  const cfg = getConfig();
  const filename = `grade_respostas_${cfg.numQuestoes}q_${cfg.alternativas}.png`;
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function copyToClipboard() {
  const canvas = document.getElementById('gradeCanvas');
  const feedback = document.getElementById('copyFeedback');

  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    feedback.textContent = '✓ Imagem copiada! Cole com Ctrl+V no Word ou Google Docs.';
    feedback.className = 'feedback success';
  } catch (err) {
    feedback.textContent = `✗ Erro ao copiar: ${err.message}. Tente o Download PNG.`;
    feedback.className = 'feedback error';
  }

  feedback.classList.remove('hidden');
  setTimeout(() => feedback.classList.add('hidden'), 5000);
}

// ─── UI: Preview em tempo real ────────────────────────────────────────────────
function updatePreview() {
  const cfg = getConfig();
  const canvas = document.getElementById('gradeCanvas');
  const { W, H } = calcDimensions(cfg);

  // Renderiza sempre com escala 1x para o preview (o download usa a escala real)
  renderGrade(canvas, { ...cfg, escala: 1 });

  document.getElementById('previewDims').textContent =
    `${W}×${H}px (1×) → ${W * cfg.escala}×${H * cfg.escala}px (${cfg.escala}× para download)`;
}

// ─── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Preview inicial
  updatePreview();

  // Atualiza ao mudar qualquer configuração
  ['cfgQuestoes', 'cfgAlternativas', 'cfgEscala', 'cfgTitulo'].forEach(id => {
    document.getElementById(id).addEventListener('change', updatePreview);
    document.getElementById(id).addEventListener('input', updatePreview);
  });
  document.querySelectorAll('input[name="cfgColunas"]').forEach(r =>
    r.addEventListener('change', updatePreview)
  );

  // Botões
  document.getElementById('btnDownload').addEventListener('click', () => {
    const cfg = getConfig();
    const canvas = document.getElementById('gradeCanvas');
    renderGrade(canvas, cfg); // renderiza na escala real para download
    downloadPNG();
    updatePreview();           // restaura preview em 1x
  });

  document.getElementById('btnCopiar').addEventListener('click', async () => {
    const cfg = getConfig();
    const tempCanvas = document.createElement('canvas');
    renderGrade(tempCanvas, cfg); // canvas temporário na escala real
    const feedback = document.getElementById('copyFeedback');
    try {
      const blob = await new Promise(res => tempCanvas.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      feedback.textContent = '✓ Imagem copiada! Cole com Ctrl+V no Word ou Google Docs.';
      feedback.className = 'feedback success';
    } catch (err) {
      feedback.textContent = `✗ Erro ao copiar: ${err.message}. Tente o Download PNG.`;
      feedback.className = 'feedback error';
    }
    feedback.classList.remove('hidden');
    setTimeout(() => feedback.classList.add('hidden'), 5000);
  });
});
