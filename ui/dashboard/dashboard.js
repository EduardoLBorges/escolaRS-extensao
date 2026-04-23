// =================================================================================
// STATE & CONSTANTS
// =================================================================================

let dashboardData = null;

const SELECTORS = {
  // Containers
  mainContainer: '#dashboard-container',
  loading: '#loading',
  progressContainer: '#progress-container',

  // Header
  professorInfo: '#professor-info',
  exportDate: '#export-date',
  headerRefresh: '#header-refresh',

  // Progress Bar
  progressFill: '#progress-fill',
  progressText: '#progress-text',
  progressStatus: '#progress-status',

  // Filters
  filterEscola: '#filter-escola',
  filterTurma: '#filter-turma',
  filterAluno: '#filter-aluno',
  clearFilters: '#clear-filters',
  exportXlsx: '#export-xlsx',

  // Data cards
  escolaCard: '.escola-card',
  turmaCard: '.turma-card',
  alunoRow: 'tbody tr'
};

// =================================================================================
// UTILITY FUNCTIONS
// =================================================================================

/**
 * Cria um elemento HTML com atributos e filhos.
 * @param {string} tag - A tag do elemento (ex: 'div').
 * @param {object} [attributes={}] - Objeto de atributos (ex: { className, id, dataset }).
 * @param {Array<Node|string>} [children=[]] - Array de nós filhos ou strings.
 * @returns {HTMLElement}
 */
function createEl(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const key in attributes) {
    if (key === 'dataset') {
      for (const dataKey in attributes.dataset) {
        element.dataset[dataKey] = attributes.dataset[dataKey];
      }
    } else if (key === 'className') {
      element.className = attributes[key];
    } else if (key === 'innerHTML') {
      element.innerHTML = attributes[key];
    } else if (key in element && key !== 'style') {
      element[key] = attributes[key];
    } else {
      element.setAttribute(key, attributes[key]);
    }
  }
  for (const child of children) {
    element.append(child);
  }
  return element;
}

function getAlunosAtivos(alunos) {
  return (alunos || []).filter(aluno => aluno.situacao?.ativo === true);
}

function getNomeComSituacao(aluno) {
  if (aluno.situacao && aluno.situacao.ativo !== true && aluno.situacao.descricao) {
    return `${aluno.nome} <span class="aluno-inativo-descricao">(${aluno.situacao.descricao})</span>`;
  }
  return aluno.nome;
}

function getClasseBadge(media) {
  if (media >= 6) return 'badge-excelente';
  if (media >= 5) return 'badge-bom';
  return 'badge-ruim';
}

/**
 * Classifica um valor de nota em uma categoria para filtragem.
 * @param {*} value - Nota numérica ou placeholder.
 * @returns {'aprov'|'recup'|'reprov'|'semnota'}
 */
function getStatusCategory(value) {
  if (value === undefined || value === null || isNaN(value) || value === '--') return 'semnota';
  if (value >= 6) return 'aprov';
  if (value >= 5) return 'recup';
  return 'reprov';
}

/**
 * Retorna o texto e classe CSS de status de um aluno.
 * @param {number} mediaFinal - Média final do aluno.
 * @param {boolean} hasGrades - Se o aluno tem notas suficientes para avaliação.
 * @returns {{ texto: string, classe: string }}
 */
function getAlunoStatus(mediaFinal, hasGrades) {
  if (!hasGrades) return { texto: '', classe: '' };
  if (mediaFinal >= 6) return { texto: 'Aprovado', classe: 'status-excellente' };
  if (mediaFinal >= 5) return { texto: 'Recuperação', classe: 'status-recuperacao' };
  return { texto: 'Reprovado', classe: 'status-reprovado' };
}

/**
 * Sanitiza o nome do período para uso como chave de dataset HTML.
 * @param {string} periodo - Ex: "1° Trim"
 * @returns {string} - Ex: "1Trim"
 */
function sanitizePeriodoKey(periodo) {
  return periodo.replace(/\s+/g, '').replace(/[°º]/g, '');
}

/**
 * Cria a célula <td> de avatar do aluno (foto ou placeholder).
 * @param {Object} aluno - Objeto do aluno.
 * @returns {HTMLElement}
 */
function createAvatarCell(aluno) {
  if (aluno.fotoBase64Thumbnail && aluno.fotoBase64Thumbnail.length > 20) {
    const src = aluno.fotoBase64Thumbnail.startsWith('data:')
      ? aluno.fotoBase64Thumbnail
      : 'data:image/jpeg;base64,' + aluno.fotoBase64Thumbnail;
    const img = createEl('img', {
      src,
      className: 'aluno-foto',
      alt: 'Foto',
      style: 'cursor: zoom-in;',
      dataset: {
        matricula: aluno.matricula,
        idTurma: aluno.idTurma
      }
    });
    img.onclick = (e) => showImageModal(e, src, aluno.nome);
    return createEl('td', { style: 'text-align:center; padding: 4px;' }, [img]);
  }

  return createEl('td', { style: 'text-align:center; padding: 4px;' }, [
    createEl('div', { className: 'aluno-foto-placeholder' }, [
      createEl('i', { 'data-lucide': 'user' }),
    ]),
  ]);
}

// =================================================================================
// DATA LOADING & MAIN FLOW
// =================================================================================

/**
 * Carrega e renderiza os dados do dashboard, usando cache se disponível.
 * @param {boolean} forceRefresh - Força a busca de novos dados.
 */
function loadDashboard(forceRefresh = false) {
  const loadingDiv = document.querySelector(SELECTORS.loading);
  const progressContainer = document.querySelector(SELECTORS.progressContainer);

  let showProgressTimeout = null;

  if (forceRefresh) {
    loadingDiv.style.display = 'none';
    progressContainer.style.display = 'none';
    document.querySelector('#refresh-progress').style.display = 'block';
    document.querySelector('#refresh-progress-bar').style.width = '0%';
  } else {
    loadingDiv.style.display = 'block';
    progressContainer.style.display = 'none';
    showProgressTimeout = setTimeout(() => {
      if (loadingDiv.style.display !== 'none') {
        loadingDiv.style.display = 'none';
        progressContainer.style.display = 'block';
      }
    }, 300);
  }

  chrome.runtime.sendMessage({ action: forceRefresh ? 'refreshDashboardData' : 'getDashboardData' }, (response) => {
    if (showProgressTimeout) clearTimeout(showProgressTimeout);
    loadingDiv.style.display = 'none';
    progressContainer.style.display = 'none';
    document.querySelector('#refresh-progress').style.display = 'none';

    if (!response || !response.success) {
      if (dashboardData && forceRefresh) {
        const pCont = document.querySelector('#refresh-progress');
        const pBar = document.querySelector('#refresh-progress-bar');

        pCont.style.display = 'block';
        pBar.style.width = '100%';
        pBar.classList.add('blink-error');

        setTimeout(() => {
          pCont.style.display = 'none';
          pBar.classList.remove('blink-error');
          pBar.style.width = '0%';
        }, 3000);

        console.error('Falha ao atualizar dados:', response?.error);
        return;
      }

      displayError(response?.error || 'Ocorreu um erro desconhecido.');
      return;
    }

    if (!forceRefresh && response.cached && new Date().toDateString() !== new Date(response.cachedAt).toDateString()) {
      console.info('Cache desatualizado, recarregando...');
      loadDashboard(true);
      return;
    }

    dashboardData = response.data;
    fstatInitialized = false;
    renderApp();
  });
}

/**
 * Renderiza a aplicação inteira na página.
 */
function renderApp() {
  const container = document.querySelector(SELECTORS.mainContainer);

  // Salva estado atual (filtros e scroll)
  const escolaInput = document.querySelector(SELECTORS.filterEscola);
  const turmaInput = document.querySelector(SELECTORS.filterTurma);
  const alunoInput = document.querySelector(SELECTORS.filterAluno);

  const currentEscola = escolaInput ? escolaInput.value : '';
  const currentTurma = turmaInput ? turmaInput.value : '';
  const currentAluno = alunoInput ? alunoInput.value : '';

  const currentScrollY = window.scrollY;

  container.innerHTML = ''; // Limpa o container principal

  if (!dashboardData || !dashboardData.escolas || dashboardData.escolas.length === 0) {
    container.appendChild(createEl('p', {}, ['Nenhuma escola ou turma encontrada para este professor.']));
    return;
  }

  // Renderiza Header
  document.querySelector('#professor-info').textContent = dashboardData.professor || 'Desconhecido';

  const dataExportacao = new Date(dashboardData.data_exportacao);
  document.querySelector('#export-date').innerHTML = `<i data-lucide="clock"></i> <span>Exportado em: ${dataExportacao.toLocaleString('pt-BR')}</span>`;

  // Renderiza Componentes
  const stats = calculateStats(dashboardData);

  container.appendChild(renderStats(stats));
  container.appendChild(renderControls(dashboardData));
  container.appendChild(createEl('div', { id: 'filtered-stats-row', className: 'filtered-stats-row' }));

  dashboardData.escolas.forEach(escola => {
    container.appendChild(renderEscola(escola));
  });

  container.appendChild(renderFooter());

  // Inicializa ícones Lucide nos elementos recém-criados
  lucide.createIcons({ nodes: [container, document.querySelector('header')] });

  // Associa eventos aos controles recém-criados
  attachControlEvents();

  // Restaura estado anterior (filtros)
  const novoEscolaInput = document.querySelector(SELECTORS.filterEscola);
  const novoTurmaInput = document.querySelector(SELECTORS.filterTurma);
  const novoAlunoInput = document.querySelector(SELECTORS.filterAluno);

  let filtrosAplicados = false;

  if (novoEscolaInput && currentEscola) {
    const optionExiste = Array.from(novoEscolaInput.options).some(opt => opt.value === currentEscola);
    if (optionExiste) {
      novoEscolaInput.value = currentEscola;
      updateTurmaDropdown();
      filtrosAplicados = true;
    }
  }

  if (novoTurmaInput && currentTurma) {
    const optionExiste = Array.from(novoTurmaInput.options).some(opt => opt.value === currentTurma);
    if (optionExiste) {
      novoTurmaInput.value = currentTurma;
      filtrosAplicados = true;
    }
  }

  if (novoAlunoInput && currentAluno) {
    novoAlunoInput.value = currentAluno;
    if (currentAluno.trim() !== '') {
      filtrosAplicados = true;
    }
  }

  // Aplica filtros (mesmo que vazios) para inicializar as estatísticas filtradas e visibilidade
  applyFilters();

  // Restaura o scroll
  setTimeout(() => {
    window.scrollTo(0, currentScrollY);
  }, 0);
}


document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // Listener para mensagens de progresso
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'updateProgress') {
      document.querySelector(SELECTORS.progressFill).style.width = request.percentage + '%';
      document.querySelector(SELECTORS.progressText).textContent = request.percentage + '%';
      document.querySelector(SELECTORS.progressStatus).textContent = request.status;

      const refreshProgressBar = document.querySelector('#refresh-progress-bar');
      if (refreshProgressBar) {
        refreshProgressBar.style.width = request.percentage + '%';
      }
    }
  });

  // Botão de atualização no header
  document.querySelector(SELECTORS.headerRefresh)?.addEventListener('click', () => loadDashboard(true));

  // Carga inicial
  loadDashboard(false);
});

// =================================================================================
// COMPONENT RENDERING FUNCTIONS
// =================================================================================

function displayError(errorMessage) {
  const container = document.querySelector(SELECTORS.mainContainer);
  container.innerHTML = '';
  container.appendChild(createEl('div', {
    style: 'text-align: center; padding: 40px; color: #1b5e20; background-color: #c8e6c9; border-radius: 8px; margin: 20px;',
    innerHTML: `<h3>Erro ao carregar dados</h3><p>${errorMessage}</p><p><strong>Dica:</strong> Certifique-se de que você está logado no portal EscolaRS em outra aba e tente recarregar esta página.</p>`
  }));
}

function renderStats(stats) {
  return createEl('div', { className: 'stats-row' }, [
    createEl('div', { className: 'stat-card' }, [
      createEl('h3', {}, ['Escolas']),
      createEl('div', { className: 'value' }, [`${dashboardData.escolas.length}`])
    ]),
    createEl('div', { className: 'stat-card' }, [
      createEl('h3', {}, ['Turmas']),
      createEl('div', { className: 'value' }, [`${stats.totalTurmas}`]),
      createEl('div', { className: 'sublabel' }, [`${stats.totalAlunos} alunos`])
    ]),
    createEl('div', { className: 'stat-card' }, [
      createEl('h3', {}, ['Média Geral']),
      createEl('div', { className: 'value' }, [`${stats.mediaGeral}`]),
      createEl('div', { className: 'sublabel' }, ['de 0 a 10'])
    ]),
    createEl('div', { className: 'stat-card' }, [
      createEl('h3', {}, ['Acima de 6.0']),
      createEl('div', { className: 'value' }, [`${stats.aprovados}`]),
      createEl('div', { className: 'sublabel' }, [`${stats.percentualAprovados}%`])
    ]),
  ]);
}

function renderControls(data) {
  const escolas = [...new Set(data.escolas.map(e => e.nome))];
  const turmas = [...new Set(data.escolas.flatMap(e => e.turmas.map(t => t.nome)))];

  const escolaOptions = [createEl('option', { value: '' }, ['Todas as escolas']), ...escolas.map(e => createEl('option', { value: e }, [e]))];
  const turmaOptions = [createEl('option', { value: '' }, ['Todas as turmas']), ...turmas.map(t => createEl('option', { value: t }, [t]))];

  const filtersGroup = createEl('div', { className: 'controls-filters' }, [
    createEl('select', { id: SELECTORS.filterEscola.slice(1), className: 'filter-select' }, escolaOptions),
    createEl('select', { id: SELECTORS.filterTurma.slice(1), className: 'filter-select' }, turmaOptions),
    createEl('input', { type: 'text', id: SELECTORS.filterAluno.slice(1), className: 'filter-input', placeholder: '\uD83D\uDD0D Buscar aluno...' }),
  ]);

  const actionsGroup = createEl('div', { className: 'controls-actions' }, [
    createEl('button', { id: SELECTORS.clearFilters.slice(1), className: 'clearfilters' }, ['Limpar']),
    createEl('button', { id: SELECTORS.exportXlsx.slice(1), className: 'export-btn', title: 'Exportar dados como planilha XLSX', innerHTML: '<i data-lucide="table"></i>' }),
  ]);

  return createEl('div', { className: 'controls' }, [filtersGroup, actionsGroup]);
}

function renderEscola(escola) {
  const turmaCards = escola.turmas.map(turma => renderTurma(turma, escola.nome));

  return createEl('div', { className: 'escola-card', dataset: { escolaNome: escola.nome } }, [
    createEl('div', { className: 'escola-header', innerHTML: `<span>${escola.nome}</span><span style="font-size: 13px; opacity: 0.9;">${escola.turmas.length} turma(s)</span>` }),
    ...turmaCards
  ]);
}

function renderTurma(turma, escolaNome) {
  const disciplinaCards = turma.disciplinas.map(disc => renderDisciplina(disc, turma.nome));

  return createEl('div', { className: 'turma-card', dataset: { turmaNome: turma.nome, escolaNome: escolaNome } }, disciplinaCards);
}

function renderDisciplina(disc, turmaNome) {
  const alunos = disc.alunos || [];
  const disciplina = disc.disciplina || 'Disciplina';

  if (disc.erro) {
    return createEl('div', { className: 'turma-card-content', dataset: { disciplinaNome: disciplina, turmaNome: turmaNome } }, [
      createEl('div', { className: 'turma-header', innerHTML: `<div style="flex: 1;"><div>${turmaNome} - ${disciplina}</div><div class="turma-info">Erro ao carregar turma</div></div>` }),
      createEl('div', { className: 'erro-turma', innerHTML: `<div style="padding: 20px; background-color: #ffebee; border-left: 4px solid #c62828; border-radius: 4px; margin: 15px 0;"><strong style="color: #c62828;">⚠️ Erro ao carregar turma</strong><p style="margin: 8px 0 0 0; font-size: 13px; color: #b71c1c;">${disc.erro}</p></div>` })
    ]);
  }

  if (alunos.length === 0) return createEl('div'); // Retorna um elemento vazio se não há alunos

  const alunosAtivos = getAlunosAtivos(alunos);
  if (alunosAtivos.length === 0) return createEl('div');

  const mediaTurma = (alunosAtivos.reduce((acc, a) => acc + (a.mediaFinal || 0), 0) / alunosAtivos.length).toFixed(1);
  const aprovados = alunosAtivos.filter(a => a.mediaFinal >= 6).length;
  const percentual = ((aprovados / alunosAtivos.length) * 100).toFixed(0);
  const alunosInativos = alunos.length - alunosAtivos.length;

  const headerHTML = `
      <div style="flex: 1;">
        <div>${turmaNome} - ${disciplina}</div>
        <div class="turma-info">
          ${alunosAtivos.length} alunos${alunosInativos > 0 ? ` (+${alunosInativos} inativos)` : ''} | Média: ${mediaTurma} | ${aprovados} aprovados (${percentual}%)
        </div>
      </div>
    `;

  return createEl('div', { className: 'turma-card-content', dataset: { disciplinaNome: disciplina, turmaNome: turmaNome } }, [
    createEl('div', { className: 'turma-header', innerHTML: headerHTML }),
    createStudentsTable(alunos, disciplina)
  ]);
}


function createStudentsTable(alunos, disciplina) {
  const periodos = detectarTipoEPeriodos(alunos).periodos;

  // Colgroup: Nº fixo | Foto fixo | Nome flex | períodos fixos | Média fixo | Status fixo
  const cols = [
    createEl('col', { style: 'width: 48px;' }),
    createEl('col', { style: 'width: 52px;' }),
    createEl('col', {}), // nome: expande
    ...periodos.map(() => createEl('col', { style: 'width: 80px;' })),
    createEl('col', { style: 'width: 80px;' }), // média: 80px é suficiente para "10,0"
    createEl('col', { style: 'width: 110px;' }), // status: 110px para "Recuperação"
  ];

  const headerRow = createEl('tr', {}, [
    createEl('th', { style: 'text-align:center;' }, ['Nº']),
    createEl('th', { style: 'text-align:center;' }, ['']), // foto
    createEl('th', {}, ['Nome']),
    ...periodos.map(p => createEl('th', { style: 'text-align:center;' }, [p])),
    createEl('th', { style: 'text-align:center;' }, ['Média']),
    createEl('th', { style: 'text-align:center;' }, ['Status']),
  ]);

  const studentRows = alunos.map(aluno => {
    const notasPeriodos = periodos.map(p => getNotaTexto(aluno.notas, p));
    const todasAsNotasPreenchidas = notasPeriodos.every(nota => nota !== '--');
    const { texto: statusTexto, classe: statusClass } = getAlunoStatus(aluno.mediaFinal, todasAsNotasPreenchidas);

    const isAtivo = aluno.situacao?.ativo === true;
    const isInativo = !isAtivo;

    let cells = [
      createEl('td', { style: 'text-align:center;' }, [isNaN(parseInt(aluno.nroNaTurma, 10)) ? '' : `${aluno.nroNaTurma}`]),
      createAvatarCell(aluno),
      createEl('td', { innerHTML: `<strong>${getNomeComSituacao(aluno)}</strong>` }),
    ];

    if (isInativo) {
      cells.push(...periodos.map(() => createEl('td', { style: 'text-align:center;' }, [''])));
      cells.push(createEl('td', {}), createEl('td', {}));
    } else {
      cells.push(...notasPeriodos.map(nota => createEl('td', { innerHTML: nota, style: 'text-align:center;' })));
      cells.push(
        createEl('td', { style: 'text-align:center;' }, [createEl('span', { className: `nota-badge ${getClasseBadge(aluno.mediaFinal)}` }, [aluno.mediaFinal.toFixed(1).replace('.', ',')])]),
        createEl('td', { style: 'text-align:center;' }, [createEl('span', { className: statusClass }, [statusTexto])])
      );
    }

    const ds = {
      alunoNome: aluno.nome.toLowerCase(),
      disciplinaNome: disciplina,
      alunoAtivo: isAtivo ? 'true' : 'false',
      statusMedia: (todasAsNotasPreenchidas || aluno.mediaFinal > 0)
        ? getStatusCategory(aluno.mediaFinal)
        : 'semnota',
    };

    periodos.forEach(p => {
      const notaStr = String(getNotaTexto(aluno.notas, p));
      let pStatus = 'semnota';
      if (notaStr !== '--') {
        pStatus = getStatusCategory(parseFloat(notaStr.replace('*', '').replace(',', '.')));
      }
      ds[`periodo${sanitizePeriodoKey(p)}`] = pStatus;
    });

    return createEl('tr', {
      className: isInativo ? 'aluno-inativo' : '',
      dataset: ds
    }, cells);
  });

  return createEl('table', { style: 'table-layout: fixed; width: 100%;' }, [
    createEl('colgroup', {}, cols),
    createEl('thead', {}, [headerRow]),
    createEl('tbody', {}, studentRows)
  ]);
}

function renderFooter() {
  return createEl('div', { className: 'footer', innerHTML: `<p>© 2026 Eduardo L. Borges · MIT License<br>Projeto independente. Não afiliado ao sistema EscolaRS.</p>` });
}


// =================================================================================
// EVENT HANDLING & FILTERING
// =================================================================================

function attachControlEvents() {
  // Quando a escola mudar, atualiza as opções de turma e depois filtra a tela
  document.querySelector(SELECTORS.filterEscola)?.addEventListener('change', () => {
    updateTurmaDropdown();
    applyFilters();
  });

  document.querySelector(SELECTORS.filterTurma)?.addEventListener('change', applyFilters);
  document.querySelector(SELECTORS.filterAluno)?.addEventListener('input', applyFilters);

  document.querySelector(SELECTORS.clearFilters)?.addEventListener('click', () => {
    document.querySelector(SELECTORS.filterEscola).value = '';
    updateTurmaDropdown(); // Restaura todas as turmas no select
    document.querySelector(SELECTORS.filterTurma).value = '';
    document.querySelector(SELECTORS.filterAluno).value = '';
    fstatCategoryFilter = null;
    applyFilters();
  });

  document.querySelector(SELECTORS.exportXlsx)?.addEventListener('click', () => {
    const escola = document.querySelector(SELECTORS.filterEscola).value;
    const turma = document.querySelector(SELECTORS.filterTurma).value;
    const aluno = document.querySelector(SELECTORS.filterAluno).value.toLowerCase();
    exportarXLSX(escola, turma, aluno);
  });
}

/**
 * Atualiza o dropdown de turmas com base na escola selecionada.
 */
function updateTurmaDropdown() {
  const escolaSelecionada = document.querySelector(SELECTORS.filterEscola).value;
  const turmaSelect = document.querySelector(SELECTORS.filterTurma);
  const turmaAtual = turmaSelect.value; // Salva a seleção atual para tentar mantê-la

  let turmas = [];

  if (escolaSelecionada === '') {
    // Se nenhuma escola estiver selecionada, pega todas as turmas de todas as escolas
    turmas = [...new Set(dashboardData.escolas.flatMap(e => e.turmas.map(t => t.nome)))];
  } else {
    // Pega apenas as turmas da escola selecionada
    const escola = dashboardData.escolas.find(e => e.nome === escolaSelecionada);
    if (escola) {
      turmas = [...new Set(escola.turmas.map(t => t.nome))];
    }
  }

  // Limpa as opções atuais
  turmaSelect.innerHTML = '';

  // Recria a opção padrão e as novas opções filtradas
  turmaSelect.appendChild(createEl('option', { value: '' }, ['Todas as turmas']));
  turmas.forEach(t => {
    turmaSelect.appendChild(createEl('option', { value: t }, [t]));
  });

  // Se a turma que estava selecionada antes ainda existir na nova lista, mantém ela.
  // Se não existir, volta para "Todas as turmas".
  if (turmas.includes(turmaAtual)) {
    turmaSelect.value = turmaAtual;
  } else {
    turmaSelect.value = '';
  }
}

/**
 * Aplica filtros de visibilidade aos elementos do DOM sem recriá-los.
 */
function applyFilters() {
  const escolaFiltro = document.querySelector(SELECTORS.filterEscola).value;
  const turmaFiltro = document.querySelector(SELECTORS.filterTurma).value;
  const alunoFiltro = document.querySelector(SELECTORS.filterAluno).value.toLowerCase();

  document.querySelectorAll(SELECTORS.escolaCard).forEach(escolaCard => {
    const escolaNome = escolaCard.dataset.escolaNome;
    const escolaMatch = !escolaFiltro || escolaNome === escolaFiltro;

    let algumaTurmaVisivelNaEscola = false;

    escolaCard.querySelectorAll('.turma-card').forEach(turmaCard => {
      const turmaNome = turmaCard.dataset.turmaNome;
      const turmaMatch = !turmaFiltro || turmaNome === turmaFiltro;

      let algumaDisciplinaVisivelNaTurma = false;

      turmaCard.querySelectorAll('.turma-card-content').forEach(disciplinaCard => {
        let algumAlunoVisivelNaDisciplina = false;

        disciplinaCard.querySelectorAll(SELECTORS.alunoRow).forEach(alunoRow => {
          const alunoNome = alunoRow.dataset.alunoNome || '';
          const alunoMatch = !alunoFiltro || alunoNome.includes(alunoFiltro);
          const isAtivo = alunoRow.dataset.alunoAtivo === 'true';

          let filterMatch = true;
          if (fstatCategoryFilter) {
            if (!isAtivo) {
              filterMatch = false;
            } else {
              let statusCheck = alunoRow.dataset.statusMedia;
              if (fstatSelectedPeriod) {
                statusCheck = alunoRow.dataset[`periodo${sanitizePeriodoKey(fstatSelectedPeriod)}`];
              }
              if (statusCheck !== fstatCategoryFilter) filterMatch = false;
            }
          }

          const isVisible = alunoMatch && filterMatch;
          alunoRow.style.display = isVisible ? '' : 'none';
          if (isVisible) {
            algumAlunoVisivelNaDisciplina = true;
          }
        });

        // Uma disciplina é visível se ela pertence a uma turma que bate com o filtro E tem algum aluno visível
        const disciplinaVisivel = turmaMatch && algumAlunoVisivelNaDisciplina;
        disciplinaCard.style.display = disciplinaVisivel ? '' : 'none';

        if (disciplinaVisivel) {
          algumaDisciplinaVisivelNaTurma = true;
        }
      });

      // Oculta a turma inteira caso nenhuma disciplina dela deva aparecer
      turmaCard.style.display = algumaDisciplinaVisivelNaTurma ? '' : 'none';

      if (algumaDisciplinaVisivelNaTurma) {
        algumaTurmaVisivelNaEscola = true;
      }
    });

    escolaCard.style.display = escolaMatch && algumaTurmaVisivelNaEscola ? '' : 'none';
  });

  updateFilteredStats();
}


function calculateFilteredStats(escolaFiltro, turmaFiltro, alunoFiltro) {
  let totalAlunos = 0;
  let aprovados = 0, emRecuperacao = 0, reprovados = 0, semNota = 0;
  const periodoNotas = {}; // { '1° Trim': [notas], '2° Trim': [notas], ... }
  let allAlunos = [];

  for (const escola of dashboardData.escolas) {
    if (escolaFiltro && escola.nome !== escolaFiltro) continue;
    for (const turma of escola.turmas) {
      if (turmaFiltro && turma.nome !== turmaFiltro) continue;
      for (const disc of turma.disciplinas) {
        for (const aluno of getAlunosAtivos(disc.alunos || [])) {
          if (alunoFiltro && !aluno.nome.toLowerCase().includes(alunoFiltro)) continue;
          allAlunos.push(aluno);
        }
      }
    }
  }

  totalAlunos = allAlunos.length;
  if (totalAlunos === 0) return null;

  const { periodos } = detectarTipoEPeriodos(allAlunos);

  for (const aluno of allAlunos) {
    // Conta status
    if (aluno.mediaFinal > 0) {
      if (aluno.mediaFinal >= 6) aprovados++;
      else if (aluno.mediaFinal >= 5) emRecuperacao++;
      else reprovados++;
    }
    // Coleta notas por periodo
    for (const per of periodos) {
      const nota = parseFloat(String(getNotaTexto(aluno.notas, per)).replace('*', '').replace(',', '.'));
      if (!isNaN(nota)) {
        if (!periodoNotas[per]) periodoNotas[per] = [];
        periodoNotas[per].push(nota);
      }
    }
  }

  const periodAverages = periodos.map((per, i) => {
    const lista = periodoNotas[per] || [];
    const media = lista.length > 0 ? (lista.reduce((a, b) => a + b, 0) / lista.length) : null;
    let ap = 0, rec = 0, rep = 0;
    for (const nota of lista) {
      if (nota >= 6) ap++;
      else if (nota >= 5) rec++;
      else rep++;
    }
    const sn = totalAlunos - (ap + rec + rep);
    return { label: per, media, aprovados: ap, emRecuperacao: rec, reprovados: rep, semNota: sn };
  });

  semNota = totalAlunos - (aprovados + emRecuperacao + reprovados);

  return { totalAlunos, aprovados, emRecuperacao, reprovados, semNota, periodAverages };
}

let fstatSelectedPeriod = null;
let fstatCategoryFilter = null;
let fstatInitialized = false;

function updateFilteredStats() {
  const container = document.getElementById('filtered-stats-row');
  if (!container) return;

  const escolaFiltro = document.querySelector(SELECTORS.filterEscola)?.value || '';
  const turmaFiltro = document.querySelector(SELECTORS.filterTurma)?.value || '';
  const alunoFiltro = document.querySelector(SELECTORS.filterAluno)?.value.toLowerCase() || '';

  if (alunoFiltro.trim() !== '') {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const stats = calculateFilteredStats(escolaFiltro, turmaFiltro, alunoFiltro);
  container.innerHTML = '';

  if (!stats) return;

  if (fstatSelectedPeriod && !stats.periodAverages.some(p => p.label === fstatSelectedPeriod)) {
    fstatSelectedPeriod = null;
  }

  // Inicialização padrão: último período com nota, ou ano se todos preenchidos
  if (!fstatInitialized) {
    const withNotes = stats.periodAverages.filter(p => p.media !== null);
    if (withNotes.length > 0 && withNotes.length < stats.periodAverages.length) {
      fstatSelectedPeriod = withNotes[withNotes.length - 1].label;
    } else {
      fstatSelectedPeriod = null;
    }
    fstatInitialized = true;
  }

  // Trend indicator comparing to previous period
  const periodCards = stats.periodAverages.map((p, i) => {
    const prev = i > 0 ? stats.periodAverages[i - 1].media : null;
    let trend = '';
    if (p.media !== null && prev !== null) {
      trend = p.media > prev ? ' <span style="color:#16a34a;">&#x2191;</span>' : p.media < prev ? ' <span style="color:#dc2626;">&#x2193;</span>' : '';
    }
    const mediaStr = p.media !== null ? p.media.toFixed(1).replace('.', ',') : '—';
    const isSelected = fstatSelectedPeriod === p.label;

    const card = createEl('div', {
      className: 'fstat-card' + (isSelected ? ' fstat-selected' : ''),
      style: 'cursor: pointer; transition: all 0.2s;'
    }, [
      createEl('div', { className: 'fstat-label' }, [p.label]),
      createEl('div', { className: 'fstat-value', innerHTML: mediaStr + trend }),
    ]);

    card.addEventListener('click', () => {
      if (fstatSelectedPeriod === p.label) {
        fstatSelectedPeriod = null;
      } else {
        fstatSelectedPeriod = p.label;
      }
      fstatCategoryFilter = null;
      applyFilters();
    });

    return { card, label: p.label };
  });

  let distData = { label: 'Distribuição (Ano)', aprovados: stats.aprovados, emRecuperacao: stats.emRecuperacao, reprovados: stats.reprovados, semNota: stats.semNota };
  if (fstatSelectedPeriod) {
    const pStats = stats.periodAverages.find(p => p.label === fstatSelectedPeriod);
    if (pStats) {
      distData = { label: `Distribuição (${pStats.label})`, aprovados: pStats.aprovados, emRecuperacao: pStats.emRecuperacao, reprovados: pStats.reprovados, semNota: pStats.semNota };
    }
  }

  const totalAprovados = distData.aprovados + distData.emRecuperacao + distData.reprovados + distData.semNota;
  const pAprov = totalAprovados > 0 ? ((distData.aprovados / totalAprovados) * 100).toFixed(0) : 0;
  const pRecup = totalAprovados > 0 ? ((distData.emRecuperacao / totalAprovados) * 100).toFixed(0) : 0;
  const pReprov = totalAprovados > 0 ? ((distData.reprovados / totalAprovados) * 100).toFixed(0) : 0;
  const pSemNota = totalAprovados > 0 ? ((distData.semNota / totalAprovados) * 100).toFixed(0) : 0;

  const createLegItem = (catKey, label, pct, count) => {
    const isSelected = fstatCategoryFilter === catKey;
    const el = createEl('span', {
      className: `fstat-leg-item${isSelected ? ' fstat-leg-selected' : ''}`,
      title: `${label}: ${count} (${pct}%)`,
      style: 'cursor: pointer; user-select: none;'
    }, [
      createEl('span', { className: `fstat-leg-dot fstat-${catKey}` }),
      `${label} ${pct}%`
    ]);
    el.addEventListener('click', () => {
      if (fstatCategoryFilter === catKey) {
        fstatCategoryFilter = null;
      } else {
        fstatCategoryFilter = catKey;
      }
      applyFilters();
    });
    return el;
  };

  const distribuicaoCard = createEl('div', { className: 'fstat-card fstat-dist' }, [
    createEl('div', { className: 'fstat-label' }, [distData.label]),
    createEl('div', { className: 'fstat-dist-bar' }, [
      createEl('div', { className: 'fstat-seg fstat-aprov', style: `width:${pAprov}%`, title: `Aprovados: ${distData.aprovados} (${pAprov}%)` }),
      createEl('div', { className: 'fstat-seg fstat-recup', style: `width:${pRecup}%`, title: `Recuperação: ${distData.emRecuperacao} (${pRecup}%)` }),
      createEl('div', { className: 'fstat-seg fstat-reprov', style: `width:${pReprov}%`, title: `Reprovados: ${distData.reprovados} (${pReprov}%)` }),
      createEl('div', { className: 'fstat-seg fstat-semnota', style: `width:${pSemNota}%`, title: `Sem Nota: ${distData.semNota} (${pSemNota}%)` }),
    ]),
    createEl('div', { className: 'fstat-dist-legend' }, [
      createLegItem('aprov', 'Aprov.', pAprov, distData.aprovados),
      createLegItem('recup', 'Recup.', pRecup, distData.emRecuperacao),
      createLegItem('reprov', 'Reprov.', pReprov, distData.reprovados),
      createLegItem('semnota', 'Sem Nota', pSemNota, distData.semNota),
    ]),
  ]);

  const alunosCard = createEl('div', { className: 'fstat-card' }, [
    createEl('div', { className: 'fstat-label' }, ['Alunos']),
    createEl('div', { className: 'fstat-value' }, [`${stats.totalAlunos}`]),
  ]);

  container.appendChild(alunosCard);

  for (const pc of periodCards) {
    container.appendChild(pc.card);
    if (fstatSelectedPeriod === pc.label) {
      container.appendChild(distribuicaoCard);
    }
  }

  if (!fstatSelectedPeriod) {
    container.appendChild(distribuicaoCard);
  }
} // <---- end updateFilteredStats


// =================================================================================
// DATA CALCULATION & EXPORT (can be moved to utils)
// =================================================================================

// Funções que permanecem em grande parte as mesmas:
// calculateStats, detectarTipoEPeriodos, getNotaTexto, exportarXLSX, etc.
// Cole o conteúdo dessas funções do arquivo original aqui.

function calculateStats(data) {
  let totalAlunos = 0;
  let totalTurmas = 0;
  let totalNotas = 0;
  let alunosComMedia = 0;
  let aprovados = 0;

  for (const escola of data.escolas) {
    for (const turma of escola.turmas) {
      totalTurmas++;
      for (const disc of turma.disciplinas) {
        const alunosAtivos = getAlunosAtivos(disc.alunos);
        totalAlunos += alunosAtivos.length;
        for (const aluno of alunosAtivos) {
          if (aluno.mediaFinal > 0) {
            totalNotas += aluno.mediaFinal;
            alunosComMedia++;
            if (aluno.mediaFinal >= 6) aprovados++;
          }
        }
      }
    }
  }

  const mediaGeral = alunosComMedia > 0 ? (totalNotas / alunosComMedia).toFixed(1) : 0;
  const percentualAprovados = totalAlunos > 0 ? ((aprovados / totalAlunos) * 100).toFixed(1) : 0;

  return { totalAlunos, totalTurmas, mediaGeral, aprovados, percentualAprovados };
}


function detectarTipoEPeriodos(alunos) {
  const periodosSet = new Set();
  let temTrimestre = false;
  let temSemestre = false;

  for (const aluno of alunos) {
    if (!aluno.notas) continue;
    for (const item of aluno.notas) {
      const nomePeriodo = (item.trimestre || item.nomePeriodo || '').toLowerCase();
      if (!nomePeriodo) continue;

      if (nomePeriodo.includes('trim')) temTrimestre = true;
      if (nomePeriodo.includes('sem')) temSemestre = true;

      const numMatch = nomePeriodo.match(/\d+/);
      if (numMatch) {
        periodosSet.add(numMatch[0]);
      }
    }
  }

  const isSemestre = temSemestre && !temTrimestre;
  const numeros = Array.from(periodosSet).map(Number).sort((a, b) => a - b);

  const periodos = numeros.map(num => {
    if (isSemestre) return `${num}° Sem`;
    return `${num}° Trim`;
  });

  return { isSemestre, periodos };
}

function normalizarNota(valor) {
  if (!valor || valor === '--') return '--';
  const numValor = parseFloat(String(valor).replace(',', '.'));
  if (isNaN(numValor)) return '--';
  return numValor.toFixed(1).replace('.', ',');
}

function getNotaTexto(lista, periodo) {
  if (!lista || lista.length === 0) return '--';

  const periodoLower = periodo.toLowerCase();
  const numMatch = periodoLower.match(/\d+/);
  if (!numMatch) return '--';

  const numPeriodo = numMatch[0];
  const isSemestre = periodoLower.includes('sem');
  const isTrimestre = periodoLower.includes('trim');

  let periodoValor = null;
  for (const item of lista) {
    const nomePeriodo = (item.trimestre || item.nomePeriodo || '').toLowerCase();
    if (!nomePeriodo) continue;

    const itemEhSemestre = nomePeriodo.includes('sem');
    const itemEhTrimestre = nomePeriodo.includes('trim');

    if ((isSemestre && itemEhSemestre || isTrimestre && itemEhTrimestre) &&
      nomePeriodo.includes(numPeriodo) && !nomePeriodo.includes('er')) {
      if (item.nota && item.nota !== '--') {
        periodoValor = item.nota;
        break;
      }
    }
  }

  let erValor = null;
  for (const item of lista) {
    const nomePeriodo = (item.trimestre || item.nomePeriodo || '').toLowerCase();
    if (!nomePeriodo) continue;

    if (nomePeriodo.includes('er') && nomePeriodo.includes(numPeriodo)) {
      if (item.nota && item.nota !== '--') {
        erValor = item.nota;
        break;
      }
    }
  }

  if (periodoValor === null && erValor === null) return '--';
  if (periodoValor === null) return `${normalizarNota(erValor)}*`;
  if (erValor === null) return normalizarNota(periodoValor);

  const periodoNum = parseFloat(String(periodoValor).replace(',', '.'));
  const erNum = parseFloat(String(erValor).replace(',', '.'));

  return (erNum > periodoNum) ? `${normalizarNota(erValor)}*` : normalizarNota(periodoValor);
}

function getNotaValorBruto(lista, periodo, isER) {
  if (!lista || lista.length === 0) return '--';

  const periodoLower = periodo.toLowerCase();
  const numMatch = periodoLower.match(/\d+/);
  if (!numMatch) return '--';

  const numPeriodo = numMatch[0];
  const isSemestre = periodoLower.includes('sem');
  const isTrimestre = periodoLower.includes('trim');

  for (const item of lista) {
    const nomePeriodo = (item.trimestre || item.nomePeriodo || '').toLowerCase();
    const itemEhSemestre = nomePeriodo.includes('sem');
    const itemEhTrimestre = nomePeriodo.includes('trim');

    if (isER) {
      if (nomePeriodo.includes('er') && nomePeriodo.includes(numPeriodo)) {
        return item.nota && item.nota !== '--' ? normalizarNota(item.nota) : '--';
      }
    } else {
      if ((isSemestre && itemEhSemestre || isTrimestre && itemEhTrimestre) &&
        nomePeriodo.includes(numPeriodo) && !nomePeriodo.includes('er')) {
        return item.nota && item.nota !== '--' ? normalizarNota(item.nota) : '--';
      }
    }
  }
  return '--';
}

function exportarXLSX(escolaSelecionada, turmaSelecionada, alunoFiltro) {
  const wb = XLSX.utils.book_new();
  let temDados = false;

  for (const escola of dashboardData.escolas) {
    if (escolaSelecionada && escola.nome !== escolaSelecionada) continue;

    for (const turma of escola.turmas) {
      if (turmaSelecionada && turma.nome !== turmaSelecionada) continue;

      let todosOsAlunos = [];
      for (const disc of turma.disciplinas) {
        todosOsAlunos = todosOsAlunos.concat(disc.alunos || []);
      }
      if (todosOsAlunos.length === 0) continue;

      const { periodos, isSemestre } = detectarTipoEPeriodos(todosOsAlunos);
      const dados = [];

      const cabecalho = ['Matrícula', 'Nome'];
      for (const periodo of periodos) {
        cabecalho.push(periodo);
        if (!isSemestre) {
          const numMatch = periodo.match(/\d+/);
          if (numMatch) cabecalho.push(`ER${numMatch[0]}`);
        }
      }
      cabecalho.push('Disciplina', 'Média Final', 'Status');
      dados.push(cabecalho);

      let temAlunosTurma = false;

      for (const disc of turma.disciplinas) {
        const alunosFiltrados = getAlunosAtivos(disc.alunos || []).filter(a => a.nome.toLowerCase().includes(alunoFiltro));

        for (const aluno of alunosFiltrados) {
          temAlunosTurma = true;
          temDados = true;

          const linha = [aluno.matricula || '', getNomeComSituacao(aluno)];

          for (const periodo of periodos) {
            linha.push(getNotaValorBruto(aluno.notas, periodo, false));
            if (!isSemestre) {
              linha.push(getNotaValorBruto(aluno.notas, periodo, true));
            }
          }

          const { texto } = getAlunoStatus(aluno.mediaFinal, aluno.mediaFinal > 0);
          const status = texto || 'Sem Notas';

          linha.push(
            disc.disciplina || '',
            aluno.mediaFinal > 0 ? aluno.mediaFinal.toFixed(1).replace('.', ',') : '--',
            status
          );
          dados.push(linha);
        }
      }

      if (temAlunosTurma && dados.length > 1) {
        const nomeAba = turma.nome.substring(0, 31);
        const ws = XLSX.utils.aoa_to_sheet(dados);

        const colWidths = [{ wch: 12 }, { wch: 25 }];
        for (const _ of periodos) {
          colWidths.push({ wch: 10 });
          if (!isSemestre) colWidths.push({ wch: 8 });
        }
        colWidths.push({ wch: 20 }, { wch: 12 }, { wch: 15 });
        ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, nomeAba);
      }
    }
  }

  if (!temDados) {
    alert('Nenhum dado para exportar com os filtros selecionados.');
    return;
  }

  const nomeArquivo = `${dashboardData.professor.replace(' ', '_')}_notas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, nomeArquivo);
}


function showImageModal(e, src, name) {
  const imgTarget = e.target;
  const { matricula, idTurma } = imgTarget.dataset;

  const rect = imgTarget.getBoundingClientRect();
  const overlay = createEl('div', { className: 'modal-overlay', style: 'background: rgba(0,0,0,0.1); backdrop-filter: none;' });

  const maxImgHeight = window.innerHeight - 80;
  let left = rect.left;

  // Impede vazamento para a direita
  if (left + 240 > window.innerWidth - 10) {
    left = window.innerWidth - 250;
  }
  if (left < 10) left = 10;

  const modalImg = createEl('img', {
    src: src,
    className: 'modal-image',
    style: `width: 100%; height: auto; display: block; max-height: ${maxImgHeight}px; object-fit: contain;`
  });

  if (matricula && idTurma) {
    chrome.runtime.sendMessage({ action: 'getStudentPhoto', matricula, idTurma }, (response) => {
      if (response && response.success && response.data && response.data.fotoBase64) {
        const fullSrc = response.data.fotoBase64.startsWith('data:')
          ? response.data.fotoBase64
          : 'data:image/jpeg;base64,' + response.data.fotoBase64;

        modalImg.src = fullSrc;
        imgTarget.src = fullSrc;

        // Atualiza no cache em memória (dashboardData) para persistir re-filtros
        if (dashboardData && dashboardData.escolas) {
          dashboardData.escolas.forEach(escola => {
            escola.turmas.forEach(turma => {
              turma.disciplinas.forEach(disc => {
                const aluno = disc.alunos?.find(a => a.matricula == matricula);
                if (aluno) {
                  aluno.fotoBase64Thumbnail = response.data.fotoBase64;
                }
              });
            });
          });
        }
      }
    });
  }

  const content = createEl('div', {
    className: 'modal-content',
    style: `position: fixed; top: 50%; left: ${left}px; translate: 0 -50%; width: 240px; z-index: 1001;`
  }, [
    createEl('div', { className: 'modal-header' }, [
      createEl('span', { style: 'font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;' }, [name]),
      createEl('button', { className: 'modal-close', innerHTML: '&times;' })
    ]),
    modalImg
  ]);

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.classList.add('fade-out');
    content.style.opacity = '0';
    setTimeout(() => {
      if (overlay.parentNode) document.body.removeChild(overlay);
    }, 200);
  };

  overlay.onclick = (ev) => { if (ev.target === overlay) closeModal(); };
  content.querySelector('.modal-close').onclick = closeModal;
}
