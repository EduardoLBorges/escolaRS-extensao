/**
 * leitor.js — Orquestrador do fluxo de 4 passos do Leitor OMR
 *
 * Fluxo:
 *   Passo 1: Configuração de Gabarito (turma, disciplina, formas A/B/...)
 *   Passo 2: Upload de Fotos
 *   Passo 3: Revisão Manual foto-a-foto (overlay + associação de aluno)
 *   Passo 4: Lançamento de Notas no EscolaRS
 */

'use strict';

// ─── Estado Global ────────────────────────────────────────────────────────────
const state = {
  activeStep: 1,
  formas: [],           // [{ id, label, answers: { 1: 'A', 2: 'B', ... } }]
  fotos: [],            // [{ file, imageData, width, height }]
  resultados: [],       // [{ fotoIdx, alunoMatricula, alunoNome, formaId, answers, nota, confirmed }]
  reviewIdx: 0,
  reviewViewMode: 'full', // 'full' (foto completa) ou 'dewarped' (bloco OMR apenas)
  config: { numQuestoes: 10, alternativas: 'ABCDE', pontosPorQuestao: 1 },
  dashData: null,       // dados do dashboardCache
  turmaAlunos: [],      // lista de alunos da turma selecionada
  turmaId: null,
  discId: null,
  instrumento: null,
  instrumentoObj: null,
};

// ─── Helpers de UI ────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function goToStep(n) {
  state.activeStep = n;
  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById(`leitorStep${i}`);
    if (el) el.classList.toggle('hidden', i !== n);
    const ind = document.querySelector(`.step[data-step="${i}"]`);
    if (ind) {
      ind.classList.toggle('active', i === n);
      ind.classList.toggle('done', i < n);
    }
  });
  if (window.lucide) window.lucide.createIcons();
}

// ─── PASSO 1: Gabarito ────────────────────────────────────────────────────────
// ─── PASSO 1: Gabarito ────────────────────────────────────────────────────────
function initStep1() {
  loadEscolasFromCache();
  loadGabaritosSalvosList();

  if (state.formas.length === 0) {
    state.formas.push({ id: Date.now(), label: 'A', answers: {} });
  }
  renderFormas();

  // Escutadores para alterar o grid de formas se nº de questões ou alternativas mudar
  document.getElementById('ltrQuestoes')?.addEventListener('change', () => renderFormas());
  document.getElementById('ltrAlt')?.addEventListener('change', () => renderFormas());

  // Botão e Select de Gabaritos Salvos
  const btnSalvar = document.getElementById('btnSalvarGabarito');
  if (btnSalvar) {
    btnSalvar.addEventListener('click', () => salvarGabaritoAtual(false));
  }

  const selSalvos = document.getElementById('selGabaritosSalvos');
  if (selSalvos) {
    selSalvos.addEventListener('change', () => {
      if (selSalvos.value) carregarGabarito(selSalvos.value);
    });
  }

  document.getElementById('btnAdicionarForma').addEventListener('click', () => {
    collectFormaAnswers();
    const label = String.fromCharCode(65 + state.formas.length); // A, B, C...
    state.formas.push({ id: Date.now(), label, answers: {} });
    renderFormas();
  });

  document.getElementById('btnStep1Next').addEventListener('click', async () => {
    const nq = parseInt(document.getElementById('ltrQuestoes').value);
    const alt = document.getElementById('ltrAlt').value;
    const pts = parseFloat(document.getElementById('ltrPontos').value);
    const cols = parseInt(document.getElementById('ltrColunas')?.value || '1', 10);

    if (state.formas.length === 0) {
      showToast('Adicione pelo menos 1 forma de gabarito.', 'warning'); return;
    }

    state.config = { numQuestoes: nq, alternativas: alt, pontosPorQuestao: pts, colunas: cols };
    collectFormaAnswers();

    const hasComplete = state.formas.every(f => Object.keys(f.answers).length === nq);
    if (!hasComplete) {
      showToast('Preencha todas as respostas em todas as formas.', 'warning'); return;
    }

    if (!state.instrumento) {
      showToast('Selecione o instrumento de avaliação antes de continuar.', 'warning'); return;
    }

    // Auto-salva silenciosamente o gabarito para este instrumento
    await salvarGabaritoAtual(true);

    goToStep(2);
  });
}

// ─── Gerenciamento de Gabaritos Salvos ───────────────────────────────────────
async function loadGabaritosSalvosList(autoSelectId = null) {
  const sel = document.getElementById('selGabaritosSalvos');
  if (!sel) return;

  sel.innerHTML = '<option value="">— Carregar Gabarito —</option>';

  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const data = await chrome.storage.local.get(['omrGabaritos']);
  const gabaritos = data.omrGabaritos || [];

  gabaritos.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.nome;
    if (autoSelectId && g.id === autoSelectId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (gabaritos.length > 0) {
    const optDel = document.createElement('option');
    optDel.value = "__MANAGE_DEL__";
    optDel.textContent = "🗑 Excluir um gabarito salvo...";
    sel.appendChild(optDel);
  }
}

async function salvarGabaritoAtual(silent = false) {
  collectFormaAnswers();

  if (!state.formas.length) {
    if (!silent) showToast('Nenhuma forma de gabarito para salvar.', 'warning');
    return null;
  }

  const nq = parseInt(document.getElementById('ltrQuestoes').value, 10) || 10;
  const alt = document.getElementById('ltrAlt').value || 'ABCDE';
  const pts = parseFloat(document.getElementById('ltrPontos').value) || 1;
  const cols = parseInt(document.getElementById('ltrColunas')?.value || '1', 10);

  // Nome padrão do gabarito
  const instrSel = document.getElementById('ltrInstrumento');
  let defaultNome = 'Gabarito';
  if (instrSel && instrSel.selectedIndex > 0) {
    defaultNome = instrSel.options[instrSel.selectedIndex].textContent.trim();
  }
  defaultNome += ` (${nq}Q - ${state.formas.length} forma${state.formas.length > 1 ? 's' : ''})`;

  let nome = defaultNome;
  if (!silent) {
    const input = prompt('Digite um nome para este gabarito:', defaultNome);
    if (input === null) return null; // Usuário cancelou
    if (input.trim()) nome = input.trim();
  }

  const newGab = {
    id: 'gab_' + (state.instrumento ? `instr_${state.instrumento}` : `manual_${Date.now()}`),
    nome,
    instrumentoId: state.instrumento || null,
    turmaId: state.turmaId || null,
    discId: state.discId || null,
    config: { numQuestoes: nq, alternativas: alt, pontosPorQuestao: pts, colunas: cols },
    formas: JSON.parse(JSON.stringify(state.formas)),
    dataCriacao: new Date().toISOString()
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await chrome.storage.local.get(['omrGabaritos']);
    let gabaritos = data.omrGabaritos || [];

    // Remove anterior se existir com mesmo ID ou mesmo instrumentoId (upsert)
    // Para salvas manuais (sem instrumento), só remove o mesmo ID exato.
    // Para salvas com instrumento, remove qualquer gabarito anterior daquele instrumento.
    if (state.instrumento) {
      gabaritos = gabaritos.filter(g => g.id !== newGab.id && g.instrumentoId !== state.instrumento);
    } else {
      gabaritos = gabaritos.filter(g => g.id !== newGab.id);
    }
    gabaritos.unshift(newGab);

    await chrome.storage.local.set({ omrGabaritos: gabaritos });
    await loadGabaritosSalvosList(newGab.id);
  }

  if (!silent) {
    showToast(`Gabarito "${nome}" salvo com sucesso!`, 'success');
  }

  return newGab;
}

async function carregarGabarito(id) {
  if (!id) return;
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const data = await chrome.storage.local.get(['omrGabaritos']);
  const gabaritos = data.omrGabaritos || [];

  if (id === "__MANAGE_DEL__") {
    const sel = document.getElementById('selGabaritosSalvos');
    sel.value = ""; // Reseta visualmente antes do prompt bloqueante
    if (gabaritos.length === 0) return;

    const op = prompt(
      "Digite o número do gabarito que deseja EXCLUIR:\n\n" +
      gabaritos.map((g, i) => `${i + 1}. ${g.nome}`).join('\n')
    );

    // Se o usuário cancelou o prompt, mantém o select em branco e retorna
    if (op === null) return;

    const idx = parseInt(op, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < gabaritos.length) {
      const removed = gabaritos.splice(idx, 1)[0];
      await chrome.storage.local.set({ omrGabaritos: gabaritos });
      await loadGabaritosSalvosList();
      showToast(`Gabarito "${removed.nome}" excluído.`, 'info');
    } else if (op.trim() !== '') {
      showToast('Número inválido. Nenhum gabarito excluído.', 'warning');
    }
    return;
  }

  const gab = gabaritos.find(g => g.id === id);
  if (!gab) return;

  // Restaura configurações de input e state.config
  if (gab.config) {
    const nqEl = document.getElementById('ltrQuestoes');
    if (nqEl) nqEl.value = gab.config.numQuestoes;

    const altEl = document.getElementById('ltrAlt');
    if (altEl) altEl.value = gab.config.alternativas;

    const ptsEl = document.getElementById('ltrPontos');
    if (ptsEl) ptsEl.value = gab.config.pontosPorQuestao;

    const colsEl = document.getElementById('ltrColunas');
    if (colsEl) colsEl.value = gab.config.colunas || 1;

    // BUG FIX: state.config deve ser atualizado para que recalcularNota use
    // o número correto de questões (e não o anterior em memória).
    state.config = {
      numQuestoes: gab.config.numQuestoes,
      alternativas: gab.config.alternativas,
      pontosPorQuestao: gab.config.pontosPorQuestao,
      colunas: gab.config.colunas || 1,
    };
  }

  // Restaura formas
  // BUG FIX: Limpa o container DOM antes de restaurar state.formas para
  // evitar que collectFormaAnswers() (chamado internamente em renderFormas)
  // escreva dados dos selects antigos nos índices do novo array.
  if (gab.formas && Array.isArray(gab.formas)) {
    const container = document.getElementById('formasContainer');
    if (container) container.innerHTML = ''; // Limpa DOM antigo antes
    state.formas = JSON.parse(JSON.stringify(gab.formas));
    renderFormas();
  }

  showToast(`Gabarito "${gab.nome}" carregado!`, 'success');
}

async function autoLoadGabaritoForInstrumento(instrumentoId) {
  if (!instrumentoId || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const data = await chrome.storage.local.get(['omrGabaritos']);
  const gabaritos = data.omrGabaritos || [];
  const gab = gabaritos.find(g => g.instrumentoId === instrumentoId);
  if (gab) {
    await carregarGabarito(gab.id);
    const sel = document.getElementById('selGabaritosSalvos');
    if (sel) sel.value = gab.id;
  }
}

function loadEscolasFromCache() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    showToast('A extensão precisa estar ativa para carregar suas turmas.', 'warning');
    return;
  }
  chrome.storage.local.get(['dashboardCache'], res => {
    if (!res?.dashboardCache?.data) {
      showToast('Nenhum dado de turmas. Abra o Dashboard primeiro.', 'warning'); return;
    }
    state.dashData = res.dashboardCache.data;

    const escolasSel = document.getElementById('ltrEscola');
    const turmasSel = document.getElementById('ltrTurma');
    const discSel = document.getElementById('ltrDisciplina');

    state.dashData.escolas.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.nome; opt.textContent = e.nome;
      escolasSel.appendChild(opt);
    });

    escolasSel.addEventListener('change', () => {
      turmasSel.innerHTML = '<option value="">— Selecione —</option>';
      discSel.innerHTML = '<option value="">— Selecione —</option>';
      turmasSel.disabled = true; discSel.disabled = true;

      const escola = state.dashData.escolas.find(e => e.nome === escolasSel.value);
      if (!escola) return;
      escola.turmas.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.nome;
        turmasSel.appendChild(opt);
      });
      turmasSel.disabled = false;
    });

    turmasSel.addEventListener('change', () => {
      discSel.innerHTML = '<option value="">— Selecione —</option>';
      discSel.disabled = true;

      const escola = state.dashData.escolas.find(e => e.nome === escolasSel.value);
      const turma = escola?.turmas.find(t => String(t.id) === turmasSel.value);
      if (!turma) return;

      state.turmaId = turma.id;
      state.turmaAlunos = [];
      turma.disciplinas.forEach(d => {
        const alunosAtivos = (d.alunos || []).filter(a => a.situacao?.ativo === true);
        alunosAtivos.forEach(a => {
          if (!state.turmaAlunos.find(x => x.matricula === a.matricula)) {
            state.turmaAlunos.push({
              matricula: a.matricula,
              nome: a.nome,
              dataMatricula: a.dataMatricula || a.dataMatriculaTurma || a.data || null
            });
          }
        });

        const opt = document.createElement('option');
        opt.value = d.id; opt.textContent = d.disciplina || d.nome;
        discSel.appendChild(opt);
      });
      state.turmaAlunos.sort((a, b) => a.nome.localeCompare(b.nome));
      discSel.disabled = false;
    });

    discSel.addEventListener('change', async () => {
      state.discId = discSel.value || null;
      state.instrumento = null;

      // Reseta seletores de período e instrumento
      const periodSel = document.getElementById('ltrPeriodo');
      const instrSel = document.getElementById('ltrInstrumento');
      periodSel.innerHTML = '<option value="">— Selecione a disciplina primeiro —</option>';
      periodSel.disabled = true;
      instrSel.innerHTML = '<option value="">— Aguardando período —</option>';
      instrSel.disabled = true;

      if (discSel.value) {
        await loadInstrumentos(state.turmaId, discSel.value);
      }
    });
  });
}

// ─── Carregamento de Instrumentos via API ─────────────────────────────────────
async function loadInstrumentos(turmaId, discId) {
  const periodSel = document.getElementById('ltrPeriodo');
  const instrSel = document.getElementById('ltrInstrumento');
  const indicator = document.getElementById('instrLoadingIndicator');

  periodSel.innerHTML = '<option value="">Carregando períodos...</option>';
  indicator?.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();

  try {
    // Usa getValidToken() para garantir token válido — tenta renovação silenciosa se ausente
    const token = await getValidToken();

    const idRecHumano = state.dashData?.idRecHumano;
    if (!idRecHumano) throw new Error('idRecHumano ausente. Atualize o Dashboard.');

    const avaliacoes = await listarAvaliacoesTurma(turmaId, discId, idRecHumano, token);

    periodSel.innerHTML = '<option value="">— Selecione o período —</option>';
    avaliacoes.forEach(av => {
      if (!av.instrumentos?.length) return;
      const opt = document.createElement('option');
      opt.value = av.id;
      opt.textContent = av.descricao;
      opt.dataset.instrumentos = JSON.stringify(av.instrumentos);
      periodSel.appendChild(opt);
    });

    if (periodSel.options.length <= 1) {
      periodSel.innerHTML = '<option value="">Nenhum período com avaliações</option>';
      return;
    }
    periodSel.disabled = false;

    // Clona o select para remover listeners anteriores
    const newPeriodSel = periodSel.cloneNode(true);
    periodSel.parentNode.replaceChild(newPeriodSel, periodSel);
    newPeriodSel.disabled = false;

    const newInstrSel = instrSel.cloneNode(true);
    instrSel.parentNode.replaceChild(newInstrSel, instrSel);

    newInstrSel.addEventListener('change', async () => {
      state.instrumento = newInstrSel.value ? parseInt(newInstrSel.value) : null;
      state.instrumentoObj = null;
      if (newInstrSel.selectedIndex >= 0) {
        const selectedOpt = newInstrSel.options[newInstrSel.selectedIndex];
        if (selectedOpt?.dataset?.instrumento) {
          try {
            state.instrumentoObj = JSON.parse(selectedOpt.dataset.instrumento);
          } catch (e) { console.error(e); }
        }
      }
      if (state.instrumento) {
        await autoLoadGabaritoForInstrumento(state.instrumento);
      }
    });

    newPeriodSel.addEventListener('change', () => {
      newInstrSel.innerHTML = '<option value="">— Selecione o instrumento —</option>';
      newInstrSel.disabled = true;
      state.instrumento = null;
      state.instrumentoObj = null;

      const selected = newPeriodSel.options[newPeriodSel.selectedIndex];
      if (!selected?.dataset?.instrumentos) return;

      try {
        const instrumentos = JSON.parse(selected.dataset.instrumentos);
        if (!instrumentos.length) {
          newInstrSel.innerHTML = '<option value="">Sem instrumentos neste período</option>';
          return;
        }
        instrumentos.forEach(ins => {
          const opt = document.createElement('option');
          opt.value = ins.id;
          opt.textContent = `${ins.nome}${ins.peso ? ` — Peso ${ins.peso}` : ''}`;
          opt.dataset.instrumento = JSON.stringify(ins);
          newInstrSel.appendChild(opt);
        });
        newInstrSel.disabled = false;
      } catch (e) { console.error(e); }
    });

  } catch (err) {
    periodSel.innerHTML = `<option value="">Erro: ${err.message}</option>`;
    showToast(`Erro ao carregar instrumentos: ${err.message}`, 'error');
  } finally {
    indicator?.classList.add('hidden');
  }
}

function renderFormas() {
  collectFormaAnswers();
  const container = document.getElementById('formasContainer');
  container.innerHTML = '';
  const nq = parseInt(document.getElementById('ltrQuestoes').value) || 20;
  const alt = document.getElementById('ltrAlt').value || 'ABCDE';
  const opts = alt.split('');

  state.formas.forEach((forma, fi) => {
    const card = document.createElement('div');
    card.className = 'forma-card';

    let answersHtml = '<div class="answers-grid">';
    for (let q = 1; q <= nq; q++) {
      answersHtml += `
        <div class="answer-cell">
          <label>Q${String(q).padStart(2, '0')}</label>
          <select data-forma="${fi}" data-questao="${q}">
            <option value="">—</option>
            ${opts.map(o => `<option value="${o}" ${forma.answers[q] === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>`;
    }
    answersHtml += '</div>';

    card.innerHTML = `
      <div class="forma-header">
        <span class="forma-title">Forma ${forma.label}</span>
        <button class="btn btn-secondary btn-sm" data-del="${fi}">
          <i data-lucide="x"></i> Remover
        </button>
      </div>
      ${answersHtml}
    `;

    card.querySelector(`[data-del="${fi}"]`).addEventListener('click', () => {
      state.formas.splice(fi, 1);
      renderFormas();
    });

    container.appendChild(card);
  });

  // Atualização em tempo real das respostas quando o usuário seleciona no dropdown
  container.querySelectorAll('select[data-forma][data-questao]').forEach(sel => {
    sel.addEventListener('change', () => {
      const fi = parseInt(sel.dataset.forma, 10);
      const q = parseInt(sel.dataset.questao, 10);
      if (state.formas[fi]) {
        if (sel.value) state.formas[fi].answers[q] = sel.value;
        else delete state.formas[fi].answers[q];
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function collectFormaAnswers() {
  document.querySelectorAll('[data-forma][data-questao]').forEach(sel => {
    const fi = parseInt(sel.dataset.forma, 10);
    const q = parseInt(sel.dataset.questao, 10);
    if (state.formas[fi]) {
      if (sel.value) state.formas[fi].answers[q] = sel.value;
      else delete state.formas[fi].answers[q];
    }
  });
}

// ─── PASSO 2: Upload de Fotos ─────────────────────────────────────────────────
function initStep2() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const thumbs = document.getElementById('thumbsGrid');
  const actions = document.getElementById('step2Actions');
  const count = document.getElementById('photoCount');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

  async function handleFiles(files) {
    const expandedFiles = [];

    for (const file of files) {
      const isZip = file.name.toLowerCase().endsWith('.zip') ||
                    file.type === 'application/zip' ||
                    file.type === 'application/x-zip-compressed';

      if (isZip) {
        if (typeof JSZip === 'undefined') {
          showToast('Biblioteca de descompactação (JSZip) não encontrada.', 'error');
          continue;
        }

        try {
          showToast(`Descompactando ${file.name}...`, 'info');
          const zip = await JSZip.loadAsync(file);
          const imagePromises = [];

          zip.forEach((relativePath, entry) => {
            if (!entry.dir && !relativePath.startsWith('__MACOSX/') && /\.(jpe?g|png|webp|bmp|heic)$/i.test(relativePath)) {
              imagePromises.push(
                entry.async('blob').then(blob => {
                  const filename = relativePath.split('/').pop() || relativePath;
                  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
                })
              );
            }
          });

          const extractedFiles = await Promise.all(imagePromises);
          if (extractedFiles.length > 0) {
            expandedFiles.push(...extractedFiles);
            showToast(`${extractedFiles.length} foto(s) extraída(s) de ${file.name}.`, 'success');
          } else {
            showToast(`Nenhuma imagem suportada encontrada dentro de ${file.name}.`, 'warning');
          }
        } catch (err) {
          console.error('[OMR ZIP]', err);
          showToast(`Erro ao abrir o arquivo ZIP ${file.name}: ${err.message}`, 'error');
        }
      } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|heic)$/i.test(file.name)) {
        expandedFiles.push(file);
      }
    }

    if (!expandedFiles.length) {
      showToast('Selecione arquivos de imagem (.jpg, .png) ou um arquivo .zip contendo fotos.', 'warning');
      return;
    }

    expandedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const id = ctx.getImageData(0, 0, img.width, img.height);
          state.fotos.push({ file, imageData: id.data, width: img.width, height: img.height });
          renderThumbs();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderThumbs() {
    thumbs.innerHTML = '';
    state.fotos.forEach((foto, i) => {
      const div = document.createElement('div');
      div.className = 'thumb-item';
      const imgEl = document.createElement('img');
      imgEl.src = URL.createObjectURL(foto.file);
      const badge = document.createElement('div');
      badge.className = 'thumb-badge';
      badge.textContent = `Foto ${i + 1}`;
      div.appendChild(imgEl); div.appendChild(badge);
      thumbs.appendChild(div);
    });
    count.textContent = state.fotos.length;
    actions.classList.toggle('hidden', state.fotos.length === 0);
  }

  document.getElementById('btnStep2Back').addEventListener('click', () => goToStep(1));

  document.getElementById('btnProcessar').addEventListener('click', async () => {
    if (!state.fotos.length) return;
    const btn = document.getElementById('btnProcessar');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Processando...';
    if (window.lucide) window.lucide.createIcons();

    state.resultados = [];

    for (let i = 0; i < state.fotos.length; i++) {
      const foto = state.fotos[i];
      const thumbEl = thumbs.children[i];
      try {
        const res = await runWorker(foto);
        state.resultados.push({
          fotoIdx: i,
          answers: res.answers,
          densities: res.densities,
          dewarpedImageData: res.dewarpedImageData,
          dewarpedWidth: res.dewarpedWidth,
          dewarpedHeight: res.dewarpedHeight,
          formaId: state.formas[0]?.id || null,
          alunoMatricula: null, alunoNome: null, nota: null, confirmed: false
        });
        thumbEl.classList.add('processed');
        thumbEl.querySelector('.thumb-badge').textContent = '✓ OK';
      } catch (err) {
        state.resultados.push({
          fotoIdx: i, answers: null, formaId: null,
          alunoMatricula: null, alunoNome: null, nota: null, confirmed: false,
          error: err.message
        });
        thumbEl.classList.add('error');
        thumbEl.querySelector('.thumb-badge').textContent = '✗ Erro';
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="cpu"></i> Processar';
    if (window.lucide) window.lucide.createIcons();

    state.reviewIdx = 0;
    goToStep(3);
    renderReview();
  });
}

// ─── Worker ───────────────────────────────────────────────────────────────────
function runWorker(foto) {
  return new Promise((resolve, reject) => {
    const workerUrl = chrome.runtime.getURL('ui/omr/omr-worker.js');
    const worker = new Worker(workerUrl);

    worker.onmessage = e => {
      const { success, progress, status, error, ...result } = e.data;
      if (progress !== undefined) return; // mensagem de progresso, ignora
      worker.terminate();
      if (success) resolve(result);
      else reject(new Error(error));
    };

    worker.onerror = err => { worker.terminate(); reject(err); };

    worker.postMessage({
      imageData: foto.imageData,
      width: foto.width,
      height: foto.height,
      _config: state.config,
      // Se o usuário calibrou manualmente, envia os fiduciais (em pixels da imagem real)
      _manualFiducials: foto.manualFiducials || null,
    });
  });
}

// ─── Calibração Manual de Cantos ─────────────────────────────────────────────
// Abre o modal de calibração para uma foto específica.
// Quando confirmado, salva os 4 pontos em foto.manualFiducials e re-processa.
function openCalibModal(fotoIdx, onConfirm) {
  const foto = state.fotos[fotoIdx];
  const modal = document.getElementById('calibModal');
  const cvs = document.getElementById('calibCanvas');
  const ctx = cvs.getContext('2d');
  const confirmBtn = document.getElementById('calibConfirm');
  const resetBtn = document.getElementById('calibReset');

  const CORNER_LABELS = ['tl', 'tr', 'bl', 'br'];
  const CORNER_COLORS = ['#ef4444', '#f97316', '#3b82f6', '#a855f7'];
  const CORNER_NAMES = ['Superior Esquerdo', 'Superior Direito', 'Inferior Esquerdo', 'Inferior Direito'];

  let points = [];  // { x, y } em coordenadas da imagem real
  let imgEl = null;
  let scaleX = 1, scaleY = 1;

  // Carrega a foto no canvas
  const loadImg = () => new Promise(res => {
    if (imgEl) { res(); return; }
    imgEl = new Image();
    imgEl.onload = () => {
      // Escala o canvas para caber na tela mantendo aspecto
      const maxW = Math.min(window.innerWidth * 0.9, 900);
      const maxH = window.innerHeight * 0.6;
      const ratio = Math.min(maxW / imgEl.width, maxH / imgEl.height);
      cvs.width = Math.round(imgEl.width * ratio);
      cvs.height = Math.round(imgEl.height * ratio);
      scaleX = imgEl.width / cvs.width;
      scaleY = imgEl.height / cvs.height;
      res();
    };
    imgEl.src = URL.createObjectURL(foto.file);
  });

  const draw = () => {
    ctx.drawImage(imgEl, 0, 0, cvs.width, cvs.height);

    // Guia de retículo em fundo escuro semi-transparente se ainda não completou
    if (points.length < 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
    }

    // Desenha os pontos já selecionados
    points.forEach(({ cx, cy }, i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = CORNER_COLORS[i] + '99';
      ctx.fill();
      ctx.strokeStyle = CORNER_COLORS[i];
      ctx.lineWidth = 3;
      ctx.stroke();

      // Cruz
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy);
      ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14);
      ctx.strokeStyle = CORNER_COLORS[i];
      ctx.lineWidth = 2;
      ctx.stroke();

      // Rótulo
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = CORNER_COLORS[i];
      ctx.lineWidth = 0;
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((i + 1).toString(), cx, cy + 4);
    });

    // Indicador do próximo ponto
    if (points.length < 4) {
      const next = points.length;
      ctx.fillStyle = CORNER_COLORS[next];
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`► Clique no ponto ${next + 1}: ${CORNER_NAMES[next]}`, 12, cvs.height - 12);
    }
  };

  const updateStepIndicators = () => {
    CORNER_LABELS.forEach((cls, i) => {
      const el = document.getElementById(`calibStep${i + 1}`);
      el.className = `calib-dot ${cls}`;
      if (i < points.length) el.classList.add('done');
      else if (i === points.length) el.classList.add('active');
    });
    confirmBtn.disabled = points.length < 4;
  };

  const reset = () => {
    points = [];
    draw();
    updateStepIndicators();
  };

  // Handler de clique no canvas
  const onCanvasClick = (e) => {
    if (points.length >= 4) return;
    const rect = cvs.getBoundingClientRect();
    // Coordenadas no canvas de exibição
    const cx = (e.clientX - rect.left) * (cvs.width / rect.width);
    const cy = (e.clientY - rect.top) * (cvs.height / rect.height);
    // Coordenadas reais na imagem
    const rx = cx * scaleX;
    const ry = cy * scaleY;
    points.push({ cx, cy, rx, ry });
    draw();
    updateStepIndicators();
  };

  // Abre o modal
  loadImg().then(() => {
    modal.classList.remove('hidden');
    draw();
    updateStepIndicators();
    if (window.lucide) window.lucide.createIcons();

    cvs.addEventListener('click', onCanvasClick);

    const close = () => {
      modal.classList.add('hidden');
      cvs.removeEventListener('click', onCanvasClick);
      resetBtn.removeEventListener('click', reset);
      confirmBtn.removeEventListener('click', handleConfirm);
      document.getElementById('calibClose').removeEventListener('click', close);
      document.getElementById('calibBackdrop');
    };

    const handleConfirm = () => {
      if (points.length < 4) return;
      // Salva os fiduciais em coordenadas da imagem real (TL, TR, BL, BR)
      foto.manualFiducials = {
        tl: { x: points[0].rx, y: points[0].ry },
        tr: { x: points[1].rx, y: points[1].ry },
        bl: { x: points[2].rx, y: points[2].ry },
        br: { x: points[3].rx, y: points[3].ry },
      };
      close();
      onConfirm();
    };

    resetBtn.addEventListener('click', reset);
    confirmBtn.addEventListener('click', handleConfirm);
    document.getElementById('calibClose').addEventListener('click', close);
    document.querySelector('.calib-backdrop').addEventListener('click', close);
  });
}

// ─── PASSO 3: Revisão ─────────────────────────────────────────────────────────
function renderReview() {
  const idx = state.reviewIdx;
  const r = state.resultados[idx];
  const foto = state.fotos[r.fotoIdx];

  document.getElementById('reviewProgress').textContent =
    `Foto ${idx + 1} de ${state.resultados.length}`;

  // Configura botão de alternar visão (Foto Completa vs Bloco OMR)
  const isDewarped = state.reviewViewMode === 'dewarped' && r && r.dewarpedImageData;
  const lblMode = document.getElementById('lblReviewViewMode');
  const btnMode = document.getElementById('btnToggleReviewView');

  if (btnMode && lblMode) {
    if (isDewarped) {
      lblMode.textContent = 'Ver Foto Completa';
      btnMode.innerHTML = '<i data-lucide="image"></i> <span>Ver Foto Completa</span>';
    } else {
      lblMode.textContent = 'Ver Bloco OMR';
      btnMode.innerHTML = '<i data-lucide="scan"></i> <span>Ver Bloco OMR</span>';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // Canvas de Overlay
  const cvs = document.getElementById('reviewCanvas');
  const ctx = cvs.getContext('2d');

  if (isDewarped) {
    // ── MODO 1: BLOCO OMR DEWARPED (CORRIGIDO) ──────────────────────────────────
    cvs.width = r.dewarpedWidth || 400;
    cvs.height = r.dewarpedHeight || 500;
    const id = new ImageData(
      new Uint8ClampedArray(r.dewarpedImageData),
      r.dewarpedWidth, r.dewarpedHeight
    );
    ctx.putImageData(id, 0, 0);

    const outW = r.dewarpedWidth;
    const outH = r.dewarpedHeight;

    // Cantos dos fiduciais
    [[0, 0, '#ef4444'], [outW, 0, '#f97316'], [0, outH, '#3b82f6'], [outW, outH, '#a855f7']].forEach(([cx, cy, color]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // Bolhas detectadas em coordenadas escaladas do bloco
    if (r.answers && r.densities) {
      r.answers.forEach(ans => {
        const det = r.densities.filter(d => d.questao === ans.questao);
        det.forEach(d => {
          const bx = d.u * outW;
          const by = d.v * outH;
          const isSelected = ans.resposta === d.opcao;

          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, Math.PI * 2);
          if (isSelected) {
            ctx.fillStyle = ans.status === 'anulada' ? 'rgba(239, 68, 68, 0.55)' : 'rgba(34, 197, 94, 0.55)';
            ctx.fill();
            ctx.strokeStyle = ans.status === 'anulada' ? '#ef4444' : '#22c55e';
            ctx.lineWidth = 2.5;
          } else {
            ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
            ctx.lineWidth = 1;
          }
          ctx.stroke();
        });
      });
    }
  } else {
    // ── MODO 2: FOTO ORIGINAL COMPLETA ─────────────────────────────────────────
    const img = new Image();
    img.onload = () => {
      cvs.width = foto.width;
      cvs.height = foto.height;
      ctx.drawImage(img, 0, 0);

      if (r && !r.error) {
        // Quad dos fiduciais destacando a área OMR na foto completa
        if (r.fiducials) {
          const { tl, tr, bl, br } = r.fiducials;
          const lineW = Math.max(3, Math.round(foto.width * 0.003));
          const dotR = Math.max(7, Math.round(foto.width * 0.007));

          ctx.beginPath();
          ctx.moveTo(tl.x, tl.y);
          ctx.lineTo(tr.x, tr.y);
          ctx.lineTo(br.x, br.y);
          ctx.lineTo(bl.x, bl.y);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
          ctx.lineWidth = lineW;
          ctx.stroke();

          // Marcadores nos 4 cantos
          [
            [tl, '#ef4444'], [tr, '#f97316'],
            [bl, '#3b82f6'], [br, '#a855f7']
          ].forEach(([pt, color]) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(2, Math.round(lineW * 0.5));
            ctx.stroke();
          });
        }

        // Overlay de bolhas nas coordenadas (x,y) reais da foto completa
        if (r.answers && r.densities) {
          const bubbleR = Math.max(8, Math.round((r.fidDistX || foto.width * 0.4) * (r.sampleRadiusRatio || 0.025)));
          const strokeW = Math.max(1.5, Math.round(foto.width * 0.0018));

          r.answers.forEach(ans => {
            const det = r.densities.filter(d => d.questao === ans.questao);
            det.forEach(d => {
              const bx = d.x;
              const by = d.y;
              const isSelected = ans.resposta === d.opcao;

              ctx.beginPath();
              ctx.arc(bx, by, bubbleR, 0, Math.PI * 2);
              if (isSelected) {
                ctx.fillStyle = ans.status === 'anulada' ? 'rgba(239, 68, 68, 0.55)' : 'rgba(34, 197, 94, 0.55)';
                ctx.fill();
                ctx.strokeStyle = ans.status === 'anulada' ? '#ef4444' : '#22c55e';
                ctx.lineWidth = strokeW * 1.8;
              } else {
                ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
                ctx.lineWidth = strokeW;
              }
              ctx.stroke();
            });
          });
        }
      }
    };
    img.src = URL.createObjectURL(foto.file);
  }


  // Dropdown de alunos
  const alunoSel = document.getElementById('reviewAluno');
  alunoSel.innerHTML = '<option value="">— Selecione o aluno —</option>';
  state.turmaAlunos.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.matricula;
    opt.textContent = `${a.nome} (${a.matricula})`;
    if (r.alunoMatricula === a.matricula) opt.selected = true;
    alunoSel.appendChild(opt);
  });

  // Dropdown de formas
  const formaSel = document.getElementById('reviewForma');
  formaSel.innerHTML = '';
  state.formas.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `Forma ${f.label}`;
    if (String(r.formaId) === String(f.id)) opt.selected = true;
    formaSel.appendChild(opt);
  });

  alunoSel.onchange = () => {
    const aluno = state.turmaAlunos.find(a => String(a.matricula) === alunoSel.value);
    r.alunoMatricula = aluno?.matricula || null;
    r.alunoNome = aluno?.nome || null;
  };

  formaSel.onchange = () => {
    r.formaId = formaSel.value ? (isNaN(formaSel.value) ? formaSel.value : Number(formaSel.value)) : null;
    recalcularNota(r);
    renderAnswersTable(r);
  };

  recalcularNota(r);
  renderAnswersTable(r);
  renderGradeSummary(r);
}

function recalcularNota(r) {
  const forma = state.formas.find(f => String(f.id) === String(r.formaId)) || state.formas[0];
  if (!r.answers || !forma) { r.nota = null; return; }

  let acertos = 0, erros = 0, branco = 0;
  const nq = state.config.numQuestoes;
  for (let q = 1; q <= nq; q++) {
    const det = r.answers.find(a => a.questao === q);
    const gab = forma.answers ? forma.answers[q] : null;
    if (!det || det.status !== 'ok') { branco++; continue; }
    if (det.resposta === gab) acertos++;
    else erros++;
  }
  r.acertos = acertos; r.erros = erros; r.branco = branco;
  r.nota = parseFloat((acertos * state.config.pontosPorQuestao).toFixed(1));
  renderGradeSummary(r);
}

function renderGradeSummary(r) {
  document.getElementById('reviewAcertos').textContent = r.acertos ?? '—';
  document.getElementById('reviewErros').textContent = r.erros ?? '—';
  document.getElementById('reviewBranco').textContent = r.branco ?? '—';
  document.getElementById('reviewNota').textContent = r.nota != null ? r.nota.toFixed(1) : '—';
}

function renderAnswersTable(r) {
  const tbody = document.getElementById('reviewAnswersBody');
  tbody.innerHTML = '';
  const forma = state.formas.find(f => String(f.id) === String(r.formaId)) || state.formas[0];
  if (!r.answers) return;

  r.answers.forEach(({ questao, resposta, status }) => {
    const gab = forma?.answers ? (forma.answers[questao] || '—') : '—';
    const isOk = resposta === gab && status === 'ok';
    const tr = document.createElement('tr');
    tr.className = status === 'ok' ? (isOk ? 'correct' : 'wrong') : 'blank';
    tr.innerHTML = `
      <td>${String(questao).padStart(2, '0')}</td>
      <td><strong>${resposta || (status === 'anulada' ? 'ANULADA' : '—')}</strong></td>
      <td>${gab}</td>
      <td>${isOk ? '✓' : (status === 'ok' ? '✗' : '○')}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function rotateCurrentFoto(direction) {
  const rIdx = state.reviewIdx;
  const r = state.resultados[rIdx];
  if (!r) return;
  const foto = state.fotos[r.fotoIdx];
  if (!foto) return;

  const btnL = document.getElementById('btnRotateLeft');
  const btnR = document.getElementById('btnRotateRight');
  if (btnL) btnL.disabled = true;
  if (btnR) btnR.disabled = true;

  showToast('Rotacionando e lendo marcadores (QR pattern)...', 'info');

  try {
    // 1. Desenha a foto atual num canvas temporário
    const srcCvs = document.createElement('canvas');
    srcCvs.width = foto.width;
    srcCvs.height = foto.height;
    const srcCtx = srcCvs.getContext('2d');
    const imgData = new ImageData(new Uint8ClampedArray(foto.imageData), foto.width, foto.height);
    srcCtx.putImageData(imgData, 0, 0);

    // 2. Cria canvas rotacionado (largura e altura invertem)
    const dstCvs = document.createElement('canvas');
    dstCvs.width = foto.height;
    dstCvs.height = foto.width;
    const dstCtx = dstCvs.getContext('2d');

    if (direction === 'cw') {
      dstCtx.translate(foto.height, 0);
      dstCtx.rotate(Math.PI / 2);
    } else {
      dstCtx.translate(0, foto.width);
      dstCtx.rotate(-Math.PI / 2);
    }

    dstCtx.drawImage(srcCvs, 0, 0);

    const newImgData = dstCtx.getImageData(0, 0, dstCvs.width, dstCvs.height);

    // Atualiza a estrutura foto
    foto.imageData = newImgData.data;
    foto.width = dstCvs.width;
    foto.height = dstCvs.height;
    foto.manualFiducials = null; // reseta calibração manual anterior para forçar detecção por QR pattern

    // Atualiza foto.file para que URL.createObjectURL funcione ao desenhar a foto completa
    const blob = await new Promise(res => dstCvs.toBlob(res, 'image/jpeg', 0.95));
    foto.file = new File([blob], foto.file ? foto.file.name : 'foto_rotated.jpg', { type: 'image/jpeg' });

    // Atualiza thumbnail no passo 2 se existir
    const thumbsContainer = document.getElementById('step2Thumbs');
    if (thumbsContainer && thumbsContainer.children[r.fotoIdx]) {
      const thumbImg = thumbsContainer.children[r.fotoIdx].querySelector('img');
      if (thumbImg) thumbImg.src = URL.createObjectURL(foto.file);
    }

    // 3. Re-executa o worker para detectar os 4 cantos pelo QR pattern na nova orientação
    const res = await runWorker(foto);

    state.resultados[rIdx] = {
      ...r,
      answers: res.answers,
      densities: res.densities,
      dewarpedImageData: res.dewarpedImageData,
      dewarpedWidth: res.dewarpedWidth,
      dewarpedHeight: res.dewarpedHeight,
      fiducials: res.fiducials,
      fidDistX: res.fidDistX,
      sampleRadiusRatio: res.sampleRadiusRatio,
      error: null
    };

    recalcularNota(state.resultados[rIdx]);
    showToast('Imagem rotacionada e marcadores lidos!', 'success');
  } catch (err) {
    console.error('[OMR Rotate]', err);
    state.resultados[rIdx] = {
      ...r,
      answers: null,
      error: err.message
    };
    showToast(`Erro na leitura OMR: ${err.message}`, 'error');
  } finally {
    if (btnL) btnL.disabled = false;
    if (btnR) btnR.disabled = false;
    renderReview();
  }
}

function initStep3() {
  const toggleBtn = document.getElementById('btnToggleReviewView');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.reviewViewMode = state.reviewViewMode === 'dewarped' ? 'full' : 'dewarped';
      renderReview();
    });
  }

  const btnRotL = document.getElementById('btnRotateLeft');
  if (btnRotL) {
    btnRotL.addEventListener('click', () => rotateCurrentFoto('ccw'));
  }
  const btnRotR = document.getElementById('btnRotateRight');
  if (btnRotR) {
    btnRotR.addEventListener('click', () => rotateCurrentFoto('cw'));
  }

  document.getElementById('btnReviewBack').addEventListener('click', () => {
    if (state.reviewIdx > 0) { state.reviewIdx--; renderReview(); }
  });

  document.getElementById('btnReviewNext').addEventListener('click', () => {
    if (state.reviewIdx < state.resultados.length - 1) { state.reviewIdx++; renderReview(); }
  });

  document.getElementById('btnConfirmarFoto').addEventListener('click', () => {
    const r = state.resultados[state.reviewIdx];
    if (!r.alunoMatricula) { showToast('Selecione o aluno antes de confirmar.', 'warning'); return; }
    recalcularNota(r);
    r.confirmed = true;
    showToast(`Foto ${state.reviewIdx + 1} confirmada!`, 'success');

    // Avança automaticamente
    if (state.reviewIdx < state.resultados.length - 1) {
      state.reviewIdx++;
      renderReview();
    } else {
      const allDone = state.resultados.every(r => r.confirmed);
      if (allDone) { renderStep4(); goToStep(4); }
      else showToast('Confirme todas as fotos para prosseguir.', 'warning');
    }
  });

  // Botão Calibrar: abre modal e re-processa a foto atual com os cantos manuais
  document.getElementById('btnRecalibrar').addEventListener('click', async () => {
    const idx = state.reviewIdx;
    const r = state.resultados[idx];
    const foto = state.fotos[r.fotoIdx];

    openCalibModal(r.fotoIdx, async () => {
      showToast('Re-processando com cantos manuais...', 'info');
      const btn = document.getElementById('btnRecalibrar');
      btn.disabled = true;

      try {
        const res = await runWorker(foto);
        state.resultados[idx] = {
          ...r,
          answers: res.answers,
          densities: res.densities,
          dewarpedImageData: res.dewarpedImageData,
          dewarpedWidth: res.dewarpedWidth,
          dewarpedHeight: res.dewarpedHeight,
          nota: null, confirmed: false,
        };
        recalcularNota(state.resultados[idx]);
        renderReview();
        showToast('Re-processado com sucesso!', 'success');
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  });
}

// ─── PASSO 4: Lançamento ──────────────────────────────────────────────────────
function renderStep4() {
  const wrapper = document.getElementById('resultsTable');
  const confirmed = state.resultados.filter(r => r.confirmed && r.nota != null);

  let html = `
    <table class="results-table">
      <thead>
        <tr>
          <th>Aluno</th>
          <th>Matrícula</th>
          <th>Forma</th>
          <th>Acertos</th>
          <th>Nota</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;

  confirmed.forEach(r => {
    const forma = state.formas.find(f => String(f.id) === String(r.formaId)) || state.formas[0];
    const cls = r.nota >= 6 ? 'aprov' : r.nota >= 5 ? 'recup' : 'reprov';
    const status = r.nota >= 6 ? 'Aprovado' : r.nota >= 5 ? 'Recuperação' : 'Reprovado';
    html += `
      <tr>
        <td>${r.alunoNome || '—'}</td>
        <td><code>${r.alunoMatricula || '—'}</code></td>
        <td>Forma ${forma?.label || '?'}</td>
        <td>${r.acertos}/${state.config.numQuestoes}</td>
        <td><span class="nota-badge ${cls}">${r.nota?.toFixed(1)}</span></td>
        <td>${status}</td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

function initStep4() {
  document.getElementById('btnStep4Back').addEventListener('click', () => {
    state.reviewIdx = 0; renderReview(); goToStep(3);
  });

  document.getElementById('btnLancar').addEventListener('click', async () => {
    const btn = document.getElementById('btnLancar');
    const progress = document.getElementById('launchProgress');
    const bar = document.getElementById('launchBar');
    const status = document.getElementById('launchStatus');

    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Enviando...';
    if (window.lucide) window.lucide.createIcons();

    // Valida token antes de prosseguir — tenta renovação silenciosa se ausente
    let token;
    try {
      token = await getValidToken();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false; return;
    }

    if (!state.instrumento) {
      showToast('Nenhum instrumento selecionado. Volte ao Passo 1.', 'error');
      btn.disabled = false; return;
    }

    const confirmed = state.resultados.filter(r => r.confirmed && r.nota != null && r.alunoMatricula);
    if (!confirmed.length) {
      showToast('Nenhuma prova confirmada para lançar.', 'warning');
      btn.disabled = false; return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const payloads = confirmed.map(r => {
      let dataParaEnvio = state.instrumentoObj?.dataAplicacao || state.instrumentoObj?.dataRealizacao || state.instrumentoObj?.data;
      const alunoObj = state.turmaAlunos.find(a => String(a.matricula) === String(r.alunoMatricula));
      const dataMat = alunoObj?.dataMatricula;

      if (dataParaEnvio && dataMat) {
        const dInst = new Date(dataParaEnvio);
        const dMat = new Date(dataMat);
        if (dMat > dInst) {
          dataParaEnvio = todayStr;
        }
      } else if (!dataParaEnvio) {
        dataParaEnvio = todayStr;
      }

      if (typeof dataParaEnvio === 'string' && dataParaEnvio.includes('T')) {
        dataParaEnvio = dataParaEnvio.split('T')[0];
      }

      return {
        idInstrumento: state.instrumento,
        idAluno: parseInt(r.alunoMatricula),
        dsAproveitamento: r.nota,
        dataRealizacao: dataParaEnvio,
      };
    });

    progress.classList.remove('hidden');
    bar.style.width = '10%';
    status.textContent = `Enviando ${payloads.length} nota(s)...`;

    // Divide em lotes de 20.
    // NOTA: não reutilizamos 'token' aqui — registrarResultadoInstrumentoLista
    // passa pelo fetchEscolaRS que sempre lê o token mais recente do storage e
    // renova automaticamente em caso de 401 durante o loop.
    const BATCH = 20;
    let sent = 0;
    let errors = 0;

    for (let i = 0; i < payloads.length; i += BATCH) {
      const batch = payloads.slice(i, i + BATCH);
      try {
        await registrarResultadoInstrumentoLista(batch, null);
        sent += batch.length;
      } catch (err) {
        errors += batch.length;
        console.error('[OMR Leitor] Erro no lote:', err);
        showToast(`Erro em lote: ${err.message}`, 'error');
      }
      const pct = Math.round(((i + BATCH) / payloads.length) * 100);
      bar.style.width = `${Math.min(pct, 100)}%`;
      status.textContent = `Enviado ${Math.min(i + BATCH, payloads.length)}/${payloads.length}...`;
    }

    bar.style.width = '100%';

    if (errors === 0) {
      status.textContent = `✓ ${sent} nota(s) lançada(s) com sucesso!`;
      showToast(`${sent} notas lançadas no EscolaRS com sucesso!`, 'success');
      btn.innerHTML = '<i data-lucide="check"></i> Notas Lançadas!';
    } else {
      status.textContent = `${sent} enviadas, ${errors} com erro.`;
      showToast(`${errors} nota(s) com erro. Verifique o console.`, 'warning');
      btn.innerHTML = '<i data-lucide="alert-triangle"></i> Lançamento Parcial';
      btn.disabled = false;
    }

    if (window.lucide) window.lucide.createIcons();
  });
}

// ─── Navegação por clique nos Indicadores de Passo ───────────────────────────
function initStepIndicator() {
  document.querySelectorAll('.step-indicator .step[data-step]').forEach(el => {
    el.addEventListener('click', () => {
      const step = parseInt(el.dataset.step, 10);
      if (!step) return;

      if (step === 1) {
        goToStep(1);
      } else if (step === 2) {
        goToStep(2);
      } else if (step === 3) {
        if (!state.resultados || state.resultados.length === 0) {
          showToast('Faça o upload e processe as fotos primeiro (Passo 2).', 'warning');
          return;
        }
        goToStep(3);
        renderReview();
      } else if (step === 4) {
        if (!state.resultados || state.resultados.length === 0) {
          showToast('Processe e revise as fotos primeiro antes do Lançamento.', 'warning');
          return;
        }
        renderStep4();
        goToStep(4);
      }
    });
  });
}

// ─── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Observa mudanças de questões/alternativas/colunas para re-renderizar formas
  ['ltrQuestoes', 'ltrAlt', 'ltrColunas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (state.formas.length > 0) renderFormas();
      });
    }
  });

  initStepIndicator();
  initStep1();
  initStep2();
  initStep3();
  initStep4();

  if (window.lucide) window.lucide.createIcons();
});
