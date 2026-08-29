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
  headerChamadas: '#header-chamadas',
  headerAvaliacoes: '#header-avaliacoes',

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

// --- UI HELPERS ---

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

// --- LIFE CYCLE & DATA ---

/**
 * Carrega e renderiza os dados do dashboard, usando cache se disponível.
 * @param {boolean} forceRefresh - Força a busca de novos dados.
 */
function loadDashboard(forceRefresh = false) {
  const loadingDiv = document.querySelector(SELECTORS.loading);
  const progressContainer = document.querySelector(SELECTORS.progressContainer);
  const refreshBtn = document.querySelector(SELECTORS.headerRefresh);

  let showProgressTimeout = null;

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }

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

    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }

    if (!response || !response.success) {
      const errorMsg = response?.error || 'Ocorreu um erro desconhecido.';
      console.error('Falha ao atualizar dados:', errorMsg);

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

        alert(`Erro ao sincronizar dados com o Portal EscolaRS:\n\n${errorMsg}\n\nCertifique-se de que você está logado no portal EscolaRS em outra aba e tente novamente.`);
        return;
      }

      displayError(errorMsg);
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

  // Floating Nav Drawer Toggle
  const btnNavToggle = document.querySelector('#btnNavToggle');
  const floatingNav = document.querySelector('#floatingNav');
  if (btnNavToggle && floatingNav) {
    btnNavToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      floatingNav.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!floatingNav.contains(e.target) && !btnNavToggle.contains(e.target)) {
        floatingNav.classList.add('hidden');
      }
    });
  }

  // Botões do Header
  document.querySelector(SELECTORS.headerRefresh)?.addEventListener('click', () => loadDashboard(true));
  document.querySelector('#nav-chamadas')?.addEventListener('click', () => {
    window.location.href = '../chamada/chamada.html';
  });
  document.querySelector('#nav-avaliacoes')?.addEventListener('click', () => {
    window.location.href = '../avaliacoes/avaliacoes.html';
  });
  document.querySelector('#nav-omr')?.addEventListener('click', () => {
    window.location.href = '../avaliacoes/avaliacoes.html?open=omr';
  });
  // Backup Handlers
  document.querySelector('#nav-export-backup')?.addEventListener('click', async () => {
    const data = await chrome.storage.local.get([
      'escolaRsHorariosCustomizados',
      'escolaRsInfrequentes',
      'escolaRsPlanosDeAula',
      'escolaRsDiasLetivos'
    ]);

    const config = {
      horariosCustomizados: data.escolaRsHorariosCustomizados || [],
      infrequentes: data.escolaRsInfrequentes || [],
      planosDeAula: data.escolaRsPlanosDeAula || [],
      diasLetivos: data.escolaRsDiasLetivos || []
    };

    if (!config.horariosCustomizados.length && !config.infrequentes.length && !config.planosDeAula.length && !config.diasLetivos.length) {
      alert("Não há dados de configurações para exportar.");
      return;
    }

    const jsonStr = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_escolaRS_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const navImportFile = document.querySelector('#nav-import-file');
  document.querySelector('#nav-import-backup')?.addEventListener('click', () => {
    navImportFile?.click();
  });

  navImportFile?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        let storageUpdate = {};

        if (Array.isArray(parsed)) {
          storageUpdate.escolaRsHorariosCustomizados = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (parsed.horariosCustomizados) storageUpdate.escolaRsHorariosCustomizados = parsed.horariosCustomizados;
          if (parsed.infrequentes) storageUpdate.escolaRsInfrequentes = parsed.infrequentes;
          if (parsed.planosDeAula) storageUpdate.escolaRsPlanosDeAula = parsed.planosDeAula;
          if (parsed.diasLetivos) storageUpdate.escolaRsDiasLetivos = parsed.diasLetivos;
        } else {
          throw new Error('Formato JSON inválido.');
        }

        await chrome.storage.local.set(storageUpdate);
        alert('Backup das configurações importado com sucesso!');
        window.location.reload();
      } catch (err) {
        alert('Erro ao importar backup: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // Carga inicial
  loadDashboard(false);
});

// --- COMPONENTS ---

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

  const headerInfoDiv = createEl('div', { style: 'flex: 1;' }, [
    createEl('div', {}, [`${turmaNome} - ${disciplina}`]),
    createEl('div', { className: 'turma-info' }, [
      `${alunosAtivos.length} alunos${alunosInativos > 0 ? ` (+${alunosInativos} inativos)` : ''} | Média: ${mediaTurma} | ${aprovados} aprovados (${percentual}%)`
    ])
  ]);

  const chartBtn = createEl('button', {
    className: 'chart-btn',
    title: 'Visualizar gráficos desta disciplina',
    innerHTML: '<i data-lucide="bar-chart-3"></i>'
  });
  chartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openChartsModal(disc, turmaNome);
  });

  const headerDiv = createEl('div', { className: 'turma-header' }, [headerInfoDiv, chartBtn]);

  return createEl('div', { className: 'turma-card-content', dataset: { disciplinaNome: disciplina, turmaNome: turmaNome } }, [
    headerDiv,
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
      cells.push(...notasPeriodos.map((nota, idx) => {
        const p = periodos[idx];
        const td = createEl('td', {
          innerHTML: nota,
          className: 'nota-periodo-cell',
          style: 'text-align:center;',
          title: `Clique para ver detalhes de ${p}`
        });
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleNotaTooltip(e, td, aluno, p, disciplina);
        });
        return td;
      }));
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

let activeNotaTooltip = null;

/**
 * Exibe ou oculta tooltip popover ancorado à célula com o detalhamento das notas do trimestre e ER.
 */
function toggleNotaTooltip(e, tdElement, aluno, periodo, disciplina) {
  if (activeNotaTooltip && activeNotaTooltip.dataset.tdId === tdElement.dataset.tooltipId) {
    closeActiveNotaTooltip();
    return;
  }

  closeActiveNotaTooltip();

  const isSemestre = periodo.toLowerCase().includes('sem');
  const tipoLabel = isSemestre ? 'Semestre' : 'Trimestre';

  const notaRegular = getNotaValorBruto(aluno.notas, periodo, false);
  const notaER = getNotaValorBruto(aluno.notas, periodo, true);
  const notaFinal = getNotaTexto(aluno.notas, periodo);

  if (!tdElement.dataset.tooltipId) {
    tdElement.dataset.tooltipId = 'tp_' + Math.random().toString(36).substring(2, 9);
  }

  const tooltip = createEl('div', {
    className: 'nota-tooltip-popover',
    dataset: { tdId: tdElement.dataset.tooltipId }
  });

  let statusMsg = '';
  if (notaER !== '--' && notaFinal.includes('*')) {
    statusMsg = `Considerada nota do ER`;
  } else if (notaER !== '--' && !notaFinal.includes('*')) {
    statusMsg = `Mantida nota do ${tipoLabel.toLowerCase()}`;
  } else if (notaRegular !== '--') {
    statusMsg = `Sem nota de ER`;
  } else {
    statusMsg = `Sem nota lançada`;
  }

  const getValBadgeClass = (valStr) => {
    if (valStr === '--') return 'val-muted';
    const n = parseNota(valStr.replace('*', ''));
    if (n >= 6) return 'val-aprov';
    if (n >= 5) return 'val-recup';
    return 'val-reprov';
  };

  tooltip.innerHTML = `
    <div class="tooltip-header">
      <strong>${aluno.nome.split(' ')[0]}</strong>
      <span class="tooltip-sub">${periodo}</span>
    </div>
    <div class="tooltip-body">
      <div class="tooltip-row">
        <span class="tooltip-lbl">Nota ${tipoLabel}:</span>
        <span class="tooltip-val ${getValBadgeClass(notaRegular)}">${notaRegular}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-lbl">Nota ER:</span>
        <span class="tooltip-val ${getValBadgeClass(notaER)}">${notaER}</span>
      </div>
      <div class="tooltip-divider"></div>
      <div class="tooltip-row highlight">
        <span class="tooltip-lbl">Final Exibida:</span>
        <span class="tooltip-val ${getValBadgeClass(notaFinal)}">${notaFinal}</span>
      </div>
    </div>
    <div class="tooltip-footer">${statusMsg}</div>
    <div class="tooltip-arrow"></div>
  `;

  document.body.appendChild(tooltip);
  activeNotaTooltip = tooltip;

  const rect = tdElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let top = rect.top + window.scrollY - tooltipRect.height - 10;
  let isAbove = true;

  if (rect.top - tooltipRect.height - 10 < 10) {
    top = rect.bottom + window.scrollY + 10;
    isAbove = false;
  }

  let left = rect.left + window.scrollX + rect.width / 2;

  const minLeft = 10 + tooltipRect.width / 2;
  const maxLeft = window.innerWidth - 10 - tooltipRect.width / 2;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.classList.add(isAbove ? 'pos-above' : 'pos-below');

  setTimeout(() => {
    document.addEventListener('click', closeActiveNotaTooltipOnOutsideClick);
    window.addEventListener('scroll', closeActiveNotaTooltip, { passive: true, once: true });
  }, 10);
}

function closeActiveNotaTooltip() {
  if (activeNotaTooltip) {
    activeNotaTooltip.remove();
    activeNotaTooltip = null;
    document.removeEventListener('click', closeActiveNotaTooltipOnOutsideClick);
  }
}

function closeActiveNotaTooltipOnOutsideClick(e) {
  if (activeNotaTooltip && !activeNotaTooltip.contains(e.target)) {
    closeActiveNotaTooltip();
  }
}

function renderFooter() {
  return createEl('div', { className: 'footer', innerHTML: `<p>© 2026 Eduardo L. Borges · MIT License<br>Projeto independente. Não afiliado ao sistema EscolaRS.</p>` });
}


// --- EVENTS & FILTERS ---

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
    exportarXLSX(dashboardData, escola, turma, aluno);
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



let fstatSelectedPeriod = null;
let fstatCategoryFilter = null;
let fstatInitialized = false;

let preVisuCalculos = {}; // Store calculations fetched
let preVisuStatus = null; // null | 'soma' | 'media'

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
  const stats = calculateFilteredStats(dashboardData, escolaFiltro, turmaFiltro, alunoFiltro);
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
      preVisuCalculos = {};
      preVisuStatus = null;
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


  const legendItems = [
    createLegItem('aprov', 'Aprov.', pAprov, distData.aprovados),
    createLegItem('recup', 'Recup.', pRecup, distData.emRecuperacao),
    createLegItem('reprov', 'Reprov.', pReprov, distData.reprovados),
    createLegItem('semnota', 'Sem Nota', pSemNota, distData.semNota),
  ];

  if (fstatSelectedPeriod && (fstatSelectedPeriod.toLowerCase().includes('trim') || fstatSelectedPeriod.toLowerCase().includes('sem'))) {
    const isPreVisLoaded = Object.keys(preVisuCalculos || {}).length > 0;

    const btnContainer = createEl('div', { style: 'margin-left: auto; display: flex; gap: 8px;' });

    if (!isPreVisLoaded) {
      const btnPreVis = createEl('span', {
        className: 'fstat-leg-item',
        title: 'Pré-visualização do período selecionado',
        style: 'cursor: pointer; user-select: none; position: relative; overflow: hidden;'
      }, [
        createEl('span', { className: 'fstat-leg-dot', style: 'background: #999;' }),
        'Pré-visualização'
      ]);

      btnPreVis.addEventListener('click', async () => {
        if (btnPreVis.classList.contains('loading')) return;
        btnPreVis.classList.add('loading');
        btnPreVis.style.pointerEvents = 'none';
        btnPreVis.innerHTML = '<div id="previs-progress" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: #4caf50; z-index: 0; transition: width 0.2s;"></div><span style="position: relative; z-index: 1;">Calculando...</span>';

        try {
          await carregarPreVisualizacaoPeriodo(fstatSelectedPeriod);
        } finally {
          applyFilters();
        }
      });

      btnContainer.appendChild(btnPreVis);
    } else {
      const isSomaSelected = preVisuStatus === 'soma';
      const btnSoma = createEl('span', {
        className: `fstat-leg-item${isSomaSelected ? ' fstat-leg-selected' : ''}`,
        title: 'Aplicar Soma',
        style: 'cursor: pointer; user-select: none;'
      }, [
        createEl('span', { className: 'fstat-leg-dot', style: 'background: #4caf50;' }),
        'Soma'
      ]);
      btnSoma.addEventListener('click', () => {
        aplicarPreVisualizacao(isSomaSelected ? null : 'soma');
      });

      const isMediaSelected = preVisuStatus === 'media';
      const btnMedia = createEl('span', {
        className: `fstat-leg-item${isMediaSelected ? ' fstat-leg-selected' : ''}`,
        title: 'Aplicar Média',
        style: 'cursor: pointer; user-select: none;'
      }, [
        createEl('span', { className: 'fstat-leg-dot', style: 'background: #2196f3;' }),
        'Média'
      ]);
      btnMedia.addEventListener('click', () => {
        aplicarPreVisualizacao(isMediaSelected ? null : 'media');
      });

      btnContainer.appendChild(btnSoma);
      btnContainer.appendChild(btnMedia);
    }
    legendItems.push(btnContainer);
  }

  const distribuicaoCard = createEl('div', { className: 'fstat-card fstat-dist' }, [
    createEl('div', { className: 'fstat-label' }, [distData.label]),
    createEl('div', { className: 'fstat-dist-bar' }, [
      createEl('div', { className: 'fstat-seg fstat-aprov', style: `width:${pAprov}%`, title: `Aprovados: ${distData.aprovados} (${pAprov}%)` }),
      createEl('div', { className: 'fstat-seg fstat-recup', style: `width:${pRecup}%`, title: `Recuperação: ${distData.emRecuperacao} (${pRecup}%)` }),
      createEl('div', { className: 'fstat-seg fstat-reprov', style: `width:${pReprov}%`, title: `Reprovados: ${distData.reprovados} (${pReprov}%)` }),
      createEl('div', { className: 'fstat-seg fstat-semnota', style: `width:${pSemNota}%`, title: `Sem Nota: ${distData.semNota} (${pSemNota}%)` }),
    ]),
    createEl('div', { className: 'fstat-dist-legend', style: 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center;' }, legendItems),
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

async function carregarPreVisualizacaoPeriodo(periodoStr) {
  if (!dashboardData || !dashboardData.idRecHumano) {
    alert("Dados incompletos no cache! Por favor, clique em 'Sincronizar' (cabeçalho).");
    return;
  }

  try {
    preVisuCalculos = await fetchPreVisualizacao(dashboardData, periodoStr, {
      onProgress: (pct) => {
        const progBar = document.getElementById('previs-progress');
        if (progBar) progBar.style.width = pct + '%';
      }
    });

    const totalCalculos = Object.keys(preVisuCalculos || {}).length;
    if (totalCalculos === 0) {
      alert("Nenhum cálculo de aproveitamento encontrado para o período selecionado.");
    }
  } catch (err) {
    console.error("[Dashboard] Erro ao carregar pré-visualização:", err);
    alert(`Erro ao calcular pré-visualização: ${err.message || err}`);
    preVisuCalculos = {};
  }
}

function aplicarPreVisualizacao(tipo) {
  preVisuStatus = tipo;

  const numMatch = fstatSelectedPeriod ? fstatSelectedPeriod.match(/\d+/) : null;
  const idPeriodo = numMatch ? numMatch[0] : null;
  if (!idPeriodo) return;

  const isSemestre = fstatSelectedPeriod ? fstatSelectedPeriod.toLowerCase().includes('sem') : false;
  const periodoLower = isSemestre ? 'sem' : 'trim';

  for (const escola of dashboardData.escolas) {
    for (const turma of escola.turmas) {
      for (const disc of turma.disciplinas) {
        if (!disc.alunos) continue;
        for (const aluno of disc.alunos) {

          // 1. REVERTER modificacoes anteriores
          if (aluno.notas) {
            let tempNotas = [];
            for (const n of aluno.notas) {
              if (n.originalNota !== undefined) {
                if (n.isPreVisAdded) {
                  // ignorar este obj totalmente, ele foi inserido
                  continue;
                } else {
                  n.nota = n.originalNota;
                  delete n.originalNota;
                }
              }
              tempNotas.push(n);
            }
            aluno.notas = tempNotas;

            if (aluno.originalMediaFinal !== undefined) {
              aluno.mediaFinal = aluno.originalMediaFinal;
              delete aluno.originalMediaFinal;
            }
          }

          if (tipo === null) continue;

          // 2. APLICAR nova modificacao
          const alunoIdToMatch = aluno.id || aluno.matricula || aluno.codigo || aluno.idAluno;
          const compositeKey = `${alunoIdToMatch}_${disc.id}`;

          let pData = preVisuCalculos[compositeKey];
          if (!pData) {
            const strKeys = Object.keys(preVisuCalculos);
            const matchedKey = strKeys.find(k =>
              k === `${aluno.matricula}_${disc.id}` ||
              k === `${aluno.id}_${disc.id}` ||
              k === `${aluno.idAluno}_${disc.id}`
            );
            if (matchedKey) pData = preVisuCalculos[matchedKey];
          }

          if (pData) {
            const valorCalculado = pData[tipo];
            if (valorCalculado !== undefined && valorCalculado !== null) {
              const notaStr = valorCalculado.toString().replace('.', ',');

              if (aluno.notas) {
                let found = false;
                for (const n of aluno.notas) {
                  const nomeTrim = (n.trimestre || n.nomePeriodo || '').toLowerCase();
                  if (nomeTrim.includes(periodoLower) && nomeTrim.includes(idPeriodo) && !nomeTrim.includes('er')) {
                    if (n.originalNota === undefined) n.originalNota = n.nota;
                    n.nota = notaStr;
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  aluno.notas.push({
                    trimestre: fstatSelectedPeriod,
                    nomePeriodo: `${idPeriodo}º ${isSemestre ? 'SEMESTRE' : 'TRIMESTRE'}`,
                    nota: notaStr,
                    originalNota: '--',
                    isPreVisAdded: true
                  });
                }

                // Recalcula media final simples para Trimestral / Semestral
                if (aluno.originalMediaFinal === undefined) aluno.originalMediaFinal = aluno.mediaFinal;

                if (isSemestre) {
                  const s1 = parseFloat(String(getNotaTexto(aluno.notas, '1° Sem')).replace(',', '.'));
                  const s2 = parseFloat(String(getNotaTexto(aluno.notas, '2° Sem')).replace(',', '.'));
                  if (!isNaN(s1) && !isNaN(s2)) {
                    aluno.mediaFinal = parseFloat(((s1 + s2) / 2).toFixed(1));
                  }
                } else {
                  const p1 = parseFloat(String(getNotaTexto(aluno.notas, '1° Trim')).replace(',', '.'));
                  const p2 = parseFloat(String(getNotaTexto(aluno.notas, '2° Trim')).replace(',', '.'));
                  const p3 = parseFloat(String(getNotaTexto(aluno.notas, '3° Trim')).replace(',', '.'));
                  if (!isNaN(p1) && !isNaN(p2) && !isNaN(p3)) {
                    aluno.mediaFinal = parseFloat(((p1 * 3 + p2 * 3 + p3 * 4) / 10).toFixed(1));
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  renderApp();
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

// --- CHARTS MODAL ---

let activeChartInstances = [];

function destroyActiveCharts() {
  for (const chart of activeChartInstances) {
    chart.destroy();
  }
  activeChartInstances = [];
}

/**
 * Abre um modal com gráficos analíticos para uma disciplina.
 * @param {Object} disc - Objeto da disciplina com alunos e notas.
 * @param {string} turmaNome - Nome da turma.
 */
function openChartsModal(disc, turmaNome) {
  const alunos = getAlunosAtivos(disc.alunos || []);
  const disciplina = disc.disciplina || 'Disciplina';

  if (alunos.length === 0) {
    alert('Nenhum aluno ativo nesta disciplina.');
    return;
  }

  const overlay = createEl('div', { className: 'charts-modal-overlay' });
  const { periodos } = detectarTipoEPeriodos(alunos);

  // Tabs definition
  const tabs = [
    { id: 'distribuicao', label: 'Distribuição', icon: 'pie-chart' },
    { id: 'histograma', label: 'Histograma', icon: 'bar-chart-2' },
    { id: 'evolucao', label: 'Evolução', icon: 'trending-up' },
    { id: 'recuperacao', label: 'Recuperação (ER)', icon: 'repeat' },
  ];

  const tabsContainer = createEl('div', { className: 'charts-tabs' });
  const canvasContainer = createEl('div', { className: 'charts-canvas-container' });

  tabs.forEach((tab, i) => {
    const tabEl = createEl('button', {
      className: 'charts-tab' + (i === 0 ? ' charts-tab-active' : ''),
      dataset: { tabId: tab.id },
      innerHTML: `<i data-lucide="${tab.icon}"></i> ${tab.label}`
    });
    tabEl.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.charts-tab').forEach(t => t.classList.remove('charts-tab-active'));
      tabEl.classList.add('charts-tab-active');
      renderChart(tab.id, canvasContainer, alunos, periodos);
    });
    tabsContainer.appendChild(tabEl);
  });

  const modalContent = createEl('div', { className: 'charts-modal' }, [
    createEl('div', { className: 'charts-modal-header' }, [
      createEl('div', {}, [
        createEl('span', { className: 'charts-modal-title' }, [`${turmaNome} — ${disciplina}`]),
        createEl('span', { className: 'charts-modal-subtitle' }, [`${alunos.length} alunos ativos`]),
      ]),
      createEl('button', { className: 'modal-close charts-modal-close', innerHTML: '&times;' }),
    ]),
    tabsContainer,
    canvasContainer,
  ]);

  overlay.appendChild(modalContent);
  document.body.appendChild(overlay);

  lucide.createIcons({ nodes: [modalContent] });

  // Render first tab
  renderChart('distribuicao', canvasContainer, alunos, periodos);

  // Close handlers
  const closeModal = () => {
    destroyActiveCharts();
    if (overlay.parentNode) document.body.removeChild(overlay);
  };

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
  modalContent.querySelector('.charts-modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

/**
 * Renderiza um gráfico específico dentro do container.
 */
function renderChart(chartId, container, alunos, periodos) {
  destroyActiveCharts();
  container.innerHTML = '';

  const hasPeriodSelector = (chartId === 'distribuicao' || chartId === 'histograma');
  let selectedPeriod = null; // null = Geral (mediaFinal)

  const renderCurrentChart = () => {
    // Remove o canvas e summary antigos, preserva o seletor
    const existingCanvas = container.querySelector('canvas');
    const existingSummary = container.querySelector('.charts-er-summary');
    const existingEmpty = container.querySelector('.charts-empty-state');
    if (existingCanvas) existingCanvas.remove();
    if (existingSummary) existingSummary.remove();
    if (existingEmpty) existingEmpty.remove();
    destroyActiveCharts();

    const canvas = createEl('canvas', { id: 'chart-canvas' });
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    switch (chartId) {
      case 'distribuicao':
        renderDistribuicaoChart(ctx, alunos, selectedPeriod);
        break;
      case 'histograma':
        renderHistogramaChart(ctx, alunos, selectedPeriod);
        break;
      case 'evolucao':
        renderEvolucaoChart(ctx, alunos, periodos);
        break;
      case 'recuperacao':
        renderRecuperacaoChart(ctx, alunos, periodos, container);
        break;
    }
  };

  if (hasPeriodSelector && periodos.length > 0) {
    const selectorBar = createEl('div', { className: 'charts-period-selector' });

    const geralBtn = createEl('button', {
      className: 'charts-period-btn charts-period-btn-active',
    }, ['Geral']);
    geralBtn.addEventListener('click', () => {
      selectedPeriod = null;
      selectorBar.querySelectorAll('.charts-period-btn').forEach(b => b.classList.remove('charts-period-btn-active'));
      geralBtn.classList.add('charts-period-btn-active');
      renderCurrentChart();
    });
    selectorBar.appendChild(geralBtn);

    periodos.forEach(p => {
      const btn = createEl('button', { className: 'charts-period-btn' }, [p]);
      btn.addEventListener('click', () => {
        selectedPeriod = p;
        selectorBar.querySelectorAll('.charts-period-btn').forEach(b => b.classList.remove('charts-period-btn-active'));
        btn.classList.add('charts-period-btn-active');
        renderCurrentChart();
      });
      selectorBar.appendChild(btn);
    });

    container.appendChild(selectorBar);
  }

  renderCurrentChart();
}

/**
 * Extrai a nota numérica de um aluno para o período selecionado, ou a média final se null.
 * @returns {number|null}
 */
function getNotaParaGrafico(aluno, selectedPeriod) {
  if (!selectedPeriod) {
    return aluno.mediaFinal > 0 ? aluno.mediaFinal : null;
  }
  const notaTxt = getNotaTexto(aluno.notas, selectedPeriod);
  if (notaTxt === '--') return null;
  const val = parseFloat(String(notaTxt).replace('*', '').replace(',', '.'));
  return isNaN(val) ? null : val;
}

// --- CHART 1: Distribuição (Donut) ---

function renderDistribuicaoChart(ctx, alunos, selectedPeriod) {
  let aprovados = 0, recuperacao = 0, reprovados = 0, semNota = 0;

  for (const aluno of alunos) {
    const nota = getNotaParaGrafico(aluno, selectedPeriod);
    if (nota !== null) {
      if (nota >= 6) aprovados++;
      else if (nota >= 5) recuperacao++;
      else reprovados++;
    } else {
      semNota++;
    }
  }

  const total = alunos.length;
  const titulo = selectedPeriod
    ? `Distribuição (${selectedPeriod}) — ${total} alunos`
    : `Distribuição de Desempenho — ${total} alunos`;

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [
        `Aprovados (${aprovados})`,
        `Recuperação (${recuperacao})`,
        `Reprovados (${reprovados})`,
        `Sem Nota (${semNota})`
      ],
      datasets: [{
        data: [aprovados, recuperacao, reprovados, semNota],
        backgroundColor: ['#16a34a', '#d97706', '#dc2626', '#9ca3af'],
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            font: { family: "'Inter', sans-serif", size: 13 },
            usePointStyle: true,
            pointStyleWidth: 12,
          }
        },
        title: {
          display: true,
          text: titulo,
          font: { family: "'Inter', sans-serif", size: 15, weight: '600' },
          color: '#1f2937',
          padding: { bottom: 16 }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = context.parsed;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${val} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  activeChartInstances.push(chart);
}

// --- CHART 2: Histograma por Faixa ---

function renderHistogramaChart(ctx, alunos, selectedPeriod) {
  const faixas = [
    { label: '0 – 2', min: 0, max: 2 },
    { label: '2 – 4', min: 2, max: 4 },
    { label: '4 – 5', min: 4, max: 5 },
    { label: '5 – 6', min: 5, max: 6 },
    { label: '6 – 8', min: 6, max: 8 },
    { label: '8 – 10', min: 8, max: 10.1 },
  ];

  const contagens = faixas.map(() => 0);
  let comNota = 0;

  for (const aluno of alunos) {
    const nota = getNotaParaGrafico(aluno, selectedPeriod);
    if (nota !== null) {
      comNota++;
      for (let i = 0; i < faixas.length; i++) {
        if (nota >= faixas[i].min && nota < faixas[i].max) {
          contagens[i]++;
          break;
        }
      }
    }
  }

  const cores = ['#dc2626', '#ef4444', '#d97706', '#eab308', '#22c55e', '#16a34a'];
  const titulo = selectedPeriod
    ? `Histograma (${selectedPeriod}) — ${comNota} alunos com nota`
    : `Histograma de Notas — ${comNota} alunos com nota`;
  const xLabel = selectedPeriod
    ? `Faixa de Nota (${selectedPeriod})`
    : 'Faixa de Nota (Média Final)';

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: faixas.map(f => f.label),
      datasets: [{
        label: 'Alunos',
        data: contagens,
        backgroundColor: cores,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 56,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            font: { family: "'Inter', sans-serif" },
            color: '#6b7280',
          },
          grid: { color: '#f1f5f9' },
          title: {
            display: true,
            text: 'Nº de Alunos',
            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
            color: '#6b7280',
          }
        },
        x: {
          ticks: {
            font: { family: "'Inter', sans-serif", size: 12 },
            color: '#6b7280',
          },
          grid: { display: false },
          title: {
            display: true,
            text: xLabel,
            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
            color: '#6b7280',
          }
        }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: titulo,
          font: { family: "'Inter', sans-serif", size: 15, weight: '600' },
          color: '#1f2937',
          padding: { bottom: 16 }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const pct = comNota > 0 ? ((context.parsed.y / comNota) * 100).toFixed(1) : 0;
              return ` ${context.parsed.y} alunos (${pct}%)`;
            }
          }
        }
      }
    }
  });

  activeChartInstances.push(chart);
}

// --- CHART 3: Evolução por Período (Line) ---

function renderEvolucaoChart(ctx, alunos, periodos) {
  const mediaPorPeriodo = periodos.map(p => {
    const notas = [];
    for (const aluno of alunos) {
      const notaTxt = getNotaTexto(aluno.notas, p);
      const nota = parseFloat(String(notaTxt).replace('*', '').replace(',', '.'));
      if (!isNaN(nota)) notas.push(nota);
    }
    return notas.length > 0 ? (notas.reduce((a, b) => a + b, 0) / notas.length) : null;
  });

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: periodos,
      datasets: [{
        label: 'Média da Turma',
        data: mediaPorPeriodo,
        borderColor: '#1F822B',
        backgroundColor: 'rgba(31, 130, 43, 0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: 6,
        pointHoverRadius: 9,
        pointBackgroundColor: '#1F822B',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 1,
            font: { family: "'Inter', sans-serif" },
            color: '#6b7280',
          },
          grid: { color: '#f1f5f9' },
          title: {
            display: true,
            text: 'Média',
            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
            color: '#6b7280',
          }
        },
        x: {
          ticks: {
            font: { family: "'Inter', sans-serif", size: 12 },
            color: '#6b7280',
          },
          grid: { display: false },
        }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Evolução da Média por Período',
          font: { family: "'Inter', sans-serif", size: 15, weight: '600' },
          color: '#1f2937',
          padding: { bottom: 16 }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return val !== null ? ` Média: ${val.toFixed(1).replace('.', ',')}` : ' Sem dados';
            }
          }
        },
        // Reference line at 6.0
        annotation: undefined, // Chart.js não tem annotation nativo, usamos plugin inline
      }
    },
    plugins: [{
      id: 'referenceLine',
      afterDraw(chart) {
        const yScale = chart.scales.y;
        const ctx = chart.ctx;
        const yPos = yScale.getPixelForValue(6);

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, yPos);
        ctx.lineTo(chart.chartArea.right, yPos);
        ctx.stroke();

        ctx.fillStyle = '#d97706';
        ctx.font = "11px 'Inter', sans-serif";
        ctx.textAlign = 'left';
        ctx.fillText('Aprovação (6,0)', chart.chartArea.left + 4, yPos - 6);
        ctx.restore();
      }
    }]
  });

  activeChartInstances.push(chart);
}

// --- CHART 4: Recuperação ER (Stacked Bar) ---

function renderRecuperacaoChart(ctx, alunos, periodos, container) {
  // Build ER data per period
  const erData = periodos.map(periodo => {
    const numMatch = periodo.match(/\d+/);
    if (!numMatch) return { label: periodo, comER: 0, recuperou: 0, naoRecuperou: 0 };
    const numPeriodo = numMatch[0];
    const isSemestre = periodo.toLowerCase().includes('sem');

    let comER = 0, recuperou = 0, naoRecuperou = 0;

    for (const aluno of alunos) {
      if (!aluno.notas) continue;

      // Find original trim/sem note for this period
      let trimNota = null;
      let erNota = null;

      for (const item of aluno.notas) {
        const nome = (item.trimestre || item.nomePeriodo || '').toLowerCase();
        if (!nome || !nome.includes(numPeriodo)) continue;

        if (nome.includes('er')) {
          const val = parseFloat(String(item.nota || '').replace(',', '.'));
          if (!isNaN(val)) erNota = val;
        } else if ((isSemestre && nome.includes('sem')) || (!isSemestre && nome.includes('trim'))) {
          const val = parseFloat(String(item.nota || '').replace(',', '.'));
          if (!isNaN(val)) trimNota = val;
        }
      }

      // Only count if student had trim < 6 (needed recovery) and has an ER note
      if (erNota !== null && trimNota !== null && trimNota < 6) {
        comER++;
        if (erNota >= 6) recuperou++;
        else naoRecuperou++;
      }
    }

    return { label: periodo, comER, recuperou, naoRecuperou };
  });

  const temER = erData.some(d => d.comER > 0);

  if (!temER) {
    ctx.canvas.style.display = 'none';
    const msg = createEl('div', { className: 'charts-empty-state' }, [
      createEl('i', { 'data-lucide': 'info', style: 'width: 40px; height: 40px; color: #9ca3af; margin-bottom: 12px;' }),
      createEl('div', { style: 'font-size: 1rem; font-weight: 600; color: #6b7280; margin-bottom: 4px;' }, ['Nenhum Exame de Recuperação registrado']),
      createEl('div', { style: 'font-size: 0.85rem; color: #9ca3af;' }, ['Os dados de ER aparecerão aqui quando houver notas de recuperação lançadas.']),
    ]);
    container.appendChild(msg);
    lucide.createIcons({ nodes: [msg] });
    return;
  }

  // Summary card
  const totalER = erData.reduce((s, d) => s + d.comER, 0);
  const totalRecuperou = erData.reduce((s, d) => s + d.recuperou, 0);
  const pctRecuperou = totalER > 0 ? ((totalRecuperou / totalER) * 100).toFixed(0) : 0;

  const summaryEl = createEl('div', { className: 'charts-er-summary' }, [
    createEl('span', {}, [`Total: ${totalER} alunos foram para ER`]),
    createEl('span', { style: 'color: #16a34a; font-weight: 600;' }, [`${totalRecuperou} recuperaram (${pctRecuperou}%)`]),
    createEl('span', { style: 'color: #dc2626; font-weight: 600;' }, [`${totalER - totalRecuperou} não recuperaram (${totalER > 0 ? (100 - pctRecuperou) : 0}%)`]),
  ]);
  container.insertBefore(summaryEl, ctx.canvas);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: erData.map(d => d.label),
      datasets: [
        {
          label: 'Recuperou (ER ≥ 6)',
          data: erData.map(d => d.recuperou),
          backgroundColor: '#16a34a',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          maxBarThickness: 56,
        },
        {
          label: 'Não Recuperou (ER < 6)',
          data: erData.map(d => d.naoRecuperou),
          backgroundColor: '#dc2626',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          maxBarThickness: 56,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          stacked: true,
          ticks: {
            stepSize: 1,
            font: { family: "'Inter', sans-serif" },
            color: '#6b7280',
          },
          grid: { color: '#f1f5f9' },
          title: {
            display: true,
            text: 'Nº de Alunos',
            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
            color: '#6b7280',
          }
        },
        x: {
          stacked: true,
          ticks: {
            font: { family: "'Inter', sans-serif", size: 12 },
            color: '#6b7280',
          },
          grid: { display: false },
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            font: { family: "'Inter', sans-serif", size: 13 },
            usePointStyle: true,
            pointStyleWidth: 12,
          }
        },
        title: {
          display: true,
          text: 'Recuperação por Exame (ER) — por Período',
          font: { family: "'Inter', sans-serif", size: 15, weight: '600' },
          color: '#1f2937',
          padding: { bottom: 16 }
        },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const d = erData[idx];
              const pct = d.comER > 0 ? ((d.recuperou / d.comER) * 100).toFixed(0) : 0;
              return `\nTotal ER: ${d.comER} | Taxa de recuperação: ${pct}%`;
            }
          }
        }
      }
    }
  });

  activeChartInstances.push(chart);
}
