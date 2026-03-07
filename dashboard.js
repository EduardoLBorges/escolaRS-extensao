let dashboardData = null;

document.addEventListener('DOMContentLoaded', () => {
  const loadingDiv = document.getElementById('loading');
  const container = document.getElementById('dashboard-container');

  chrome.runtime.sendMessage({ action: 'getDashboardData' }, (response) => {
    loadingDiv.style.display = 'none';

    if (!response || !response.success) {
      displayError(container, response?.error || 'Ocorreu um erro desconhecido.');
      console.error('Falha ao obter dados do dashboard:', response?.error);
      return;
    }

    dashboardData = response.data;
    
    document.getElementById('professor-info').textContent = `Professor: ${dashboardData.professor}`;
    const dataExport = new Date(dashboardData.data_exportacao);
    document.getElementById('export-date').textContent = `Exportado em: ${dataExport.toLocaleString('pt-BR')}`;
    
    renderDashboard();
  });
});

function displayError(container, errorMessage) {
  container.innerHTML = `<div style="text-align: center; padding: 40px; color: #1b5e20; background-color: #c8e6c9; border-radius: 8px; margin: 20px;">
    <h3>❌ Erro ao carregar dados</h3>
    <p>${errorMessage}</p>
    <p><strong>Dica:</strong> Certifique-se de que você está logado no portal EscolaRS em outra aba e tente recarregar esta página.</p>
  </div>`;
}

function renderDashboard() {
  const container = document.getElementById('dashboard-container');
  
  if (!dashboardData.escolas || dashboardData.escolas.length === 0) {
    container.innerHTML = '<p>Nenhuma escola ou turma encontrada para este professor.</p>';
    return;
  }

  container.innerHTML = '';
  
  const controls = createControls();
  container.appendChild(controls);
  
  const stats = calculateStats(dashboardData);
  
  // Adicionar estatísticas
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <h3>📚 Total de Alunos</h3>
        <div class="value">${stats.totalAlunos}</div>
      </div>
      <div class="stat-card">
        <h3>🏫 Escolas</h3>
        <div class="value">${dashboardData.escolas.length}</div>
      </div>
      <div class="stat-card">
        <h3>📊 Média Geral</h3>
        <div class="value">${stats.mediaGeral}</div>
        <div class="sublabel">de 0 a 10</div>
      </div>
      <div class="stat-card">
        <h3>✅ Acima de 7.0</h3>
        <div class="value">${stats.aprovados}</div>
        <div class="sublabel">${stats.percentualAprovados}%</div>
      </div>
    </div>
  `;
  
  container.insertAdjacentHTML('afterbegin', statsHtml);

  // Renderizar escolas e turmas
  for (const escola of dashboardData.escolas) {
    const escolaCard = document.createElement('div');
    escolaCard.className = 'escola-card';
    
    const escolaHeader = document.createElement('div');
    escolaHeader.className = 'escola-header';
    escolaHeader.innerHTML = `<span>🏫 ${escola.nome}</span><span style="font-size: 13px; opacity: 0.9;">${escola.turmas.length} turma(s)</span>`;
    escolaCard.appendChild(escolaHeader);

    for (const turma of escola.turmas) {
      const turmaCard = document.createElement('div');
      turmaCard.className = 'turma-card';

      const alunos = turma.disciplinas[0]?.alunos || [];
      const disciplina = turma.disciplinas[0]?.disciplina || 'Disciplina';
      
      if (alunos.length === 0) continue;
      
      const mediaTurma = (alunos.reduce((acc, a) => acc + (a.mediaFinal || 0), 0) / alunos.length).toFixed(1);
      const aprovados = alunos.filter(a => a.mediaFinal >= 7).length;
      const percentual = ((aprovados / alunos.length) * 100).toFixed(0);

      const turmaHeader = document.createElement('div');
      turmaHeader.className = 'turma-header';
      turmaHeader.innerHTML = `
        <div style="flex: 1;">
          <div>📖 ${turma.nome} - ${disciplina}</div>
          <div class="turma-info">
            ${alunos.length} alunos | Média: ${mediaTurma} | ✅ ${aprovados} aprovados (${percentual}%)
          </div>
        </div>
      `;
      turmaCard.appendChild(turmaHeader);

      const table = createStudentsTable(alunos);
      turmaCard.appendChild(table);
      escolaCard.appendChild(turmaCard);
    }
    container.appendChild(escolaCard);
  }
  
  // Rodapé
  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.innerHTML = `<p>Dashboard atualizado em ${new Date().toLocaleTimeString('pt-BR')}</p>`;
  container.appendChild(footer);
}

function calculateStats(data) {
  let totalAlunos = 0;
  let totalNotas = 0;
  let alunosComMedia = 0;
  let aprovados = 0;

  for (const escola of data.escolas) {
    for (const turma of escola.turmas) {
      for (const disc of turma.disciplinas) {
        totalAlunos += disc.alunos.length;
        for (const aluno of disc.alunos) {
          if (aluno.mediaFinal > 0) {
            totalNotas += aluno.mediaFinal;
            alunosComMedia++;
            if (aluno.mediaFinal >= 7) aprovados++;
          }
        }
      }
    }
  }
  
  const mediaGeral = alunosComMedia > 0 ? (totalNotas / alunosComMedia).toFixed(1) : 0;
  const percentualAprovados = totalAlunos > 0 ? ((aprovados / totalAlunos) * 100).toFixed(1) : 0;

  return { totalAlunos, mediaGeral, aprovados, percentualAprovados };
}

function createControls() {
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'controls';
  
  // Filtro de Escola
  const escolas = [...new Set(dashboardData.escolas.map(e => e.nome))];
  const escolaControl = document.createElement('div');
  escolaControl.className = 'control-group';
  const escolaSelect = document.createElement('select');
  escolaSelect.id = 'filter-escola';
  
  const escolaOption = document.createElement('option');
  escolaOption.value = '';
  escolaOption.textContent = 'Todas as escolas';
  escolaSelect.appendChild(escolaOption);
  
  escolas.forEach(e => {
    const option = document.createElement('option');
    option.value = e;
    option.textContent = e;
    escolaSelect.appendChild(option);
  });
  
  escolaControl.innerHTML = '<label>🏫 Escola</label>';
  escolaControl.appendChild(escolaSelect);
  
  // Filtro de Turma
  const turmaControl = document.createElement('div');
  turmaControl.className = 'control-group';
  const turmaSelect = document.createElement('select');
  turmaSelect.id = 'filter-turma';
  
  const turmaOption = document.createElement('option');
  turmaOption.value = '';
  turmaOption.textContent = 'Todas as turmas';
  turmaSelect.appendChild(turmaOption);
  
  turmaControl.innerHTML = '<label>📚 Turma</label>';
  turmaControl.appendChild(turmaSelect);
  
  // Busca por Aluno
  const alunoControl = document.createElement('div');
  alunoControl.className = 'control-group';
  const alunoInput = document.createElement('input');
  alunoInput.type = 'text';
  alunoInput.id = 'filter-aluno';
  alunoInput.placeholder = 'Digite o nome...';
  
  alunoControl.innerHTML = '<label>👤 Buscar Aluno</label>';
  alunoControl.appendChild(alunoInput);
  
  // Botão de limpar filtros
  const clearControl = document.createElement('div');
  clearControl.className = 'control-group';
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-filters';
  clearBtn.className = 'clearfilters';
  clearBtn.textContent = '🔄 Limpar Filtros';
  
  clearControl.innerHTML = '<label>&nbsp;</label>';
  clearControl.appendChild(clearBtn);
  
  controlsDiv.appendChild(escolaControl);
  controlsDiv.appendChild(turmaControl);
  controlsDiv.appendChild(alunoControl);
  controlsDiv.appendChild(clearControl);
  
  // Event listeners - agora os elementos já existem
  escolaSelect.addEventListener('change', () => {
    updateTurmaFilter(escolaSelect.value, turmaSelect);
    applyFilters();
  });
  
  turmaSelect.addEventListener('change', applyFilters);
  alunoInput.addEventListener('input', applyFilters);
  clearBtn.addEventListener('click', () => {
    escolaSelect.value = '';
    turmaSelect.value = '';
    alunoInput.value = '';
    updateTurmaFilter('', turmaSelect);
    applyFilters();
  });
  
  // Inicializar turmas
  updateTurmaFilter('', turmaSelect);
  
  return controlsDiv;
}

function updateTurmaFilter(escolaSelecionada, turmaSelect) {
  if (!turmaSelect) turmaSelect = document.getElementById('filter-turma');
  if (!turmaSelect) return;
  
  // Limpar opções existentes
  turmaSelect.innerHTML = '';
  
  const turmaOption = document.createElement('option');
  turmaOption.value = '';
  turmaOption.textContent = 'Todas as turmas';
  turmaSelect.appendChild(turmaOption);
  
  let turmas = [];
  for (const escola of dashboardData.escolas) {
    if (!escolaSelecionada || escola.nome === escolaSelecionada) {
      for (const turma of escola.turmas) {
        turmas.push(turma.nome);
      }
    }
  }
  
  turmas = [...new Set(turmas)];
  turmas.forEach(turma => {
    const option = document.createElement('option');
    option.value = turma;
    option.textContent = turma;
    turmaSelect.appendChild(option);
  });
}

function applyFilters() {
  const container = document.getElementById('dashboard-container');
  if (!container) return;
  
  // SALVAR valores dos filtros ANTES de limpar
  const escolaSelecionada = document.getElementById('filter-escola')?.value || '';
  const turmaSelecionada = document.getElementById('filter-turma')?.value || '';
  const alunoFiltro = document.getElementById('filter-aluno')?.value?.toLowerCase() || '';
  
  // LIMPAR container
  container.innerHTML = '';
  
  // RECRIAR controles
  const controls = createControls();
  container.appendChild(controls);
  
  // RESTAURAR valores nos elementos recém-criados
  const escolaSelect = document.getElementById('filter-escola');
  const turmaSelect = document.getElementById('filter-turma');
  const alunoInput = document.getElementById('filter-aluno');
  
  if (escolaSelect) escolaSelect.value = escolaSelecionada;
  if (turmaSelect) turmaSelect.value = turmaSelecionada;
  if (alunoInput) alunoInput.value = alunoFiltro;
  
  // Recriar stats
  const stats = calculateStats(dashboardData);
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <h3>📚 Total de Alunos</h3>
        <div class="value">${stats.totalAlunos}</div>
      </div>
      <div class="stat-card">
        <h3>🏫 Escolas</h3>
        <div class="value">${dashboardData.escolas.length}</div>
      </div>
      <div class="stat-card">
        <h3>📊 Média Geral</h3>
        <div class="value">${stats.mediaGeral}</div>
        <div class="sublabel">de 0 a 10</div>
      </div>
      <div class="stat-card">
        <h3>✅ Acima de 7.0</h3>
        <div class="value">${stats.aprovados}</div>
        <div class="sublabel">${stats.percentualAprovados}%</div>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('afterbegin', statsHtml);

  // Renderizar com filtros
  for (const escola of dashboardData.escolas) {
    if (escolaSelecionada && escola.nome !== escolaSelecionada) continue;

    const escolaCard = document.createElement('div');
    escolaCard.className = 'escola-card';
    
    const escolaHeader = document.createElement('div');
    escolaHeader.className = 'escola-header';
    escolaHeader.innerHTML = `<span>🏫 ${escola.nome}</span>`;
    escolaCard.appendChild(escolaHeader);

    let temTurmas = false;

    for (const turma of escola.turmas) {
      if (turmaSelecionada && turma.nome !== turmaSelecionada) continue;

      const alunos = turma.disciplinas[0]?.alunos || [];
      const alunosFiltrados = alunos.filter(a => a.nome.toLowerCase().includes(alunoFiltro));
      
      if (alunosFiltrados.length === 0) continue;
      
      temTurmas = true;
      const turmaCard = document.createElement('div');
      turmaCard.className = 'turma-card';

      const mediaTurma = alunosFiltrados.length > 0 
        ? (alunosFiltrados.reduce((acc, a) => acc + (a.mediaFinal || 0), 0) / alunosFiltrados.length).toFixed(1)
        : 0;
      const aprovados = alunosFiltrados.filter(a => a.mediaFinal >= 7).length;
      const percentual = alunosFiltrados.length > 0 ? ((aprovados / alunosFiltrados.length) * 100).toFixed(0) : 0;

      const turmaHeader = document.createElement('div');
      turmaHeader.className = 'turma-header';
      turmaHeader.innerHTML = `
        <div style="flex: 1;">
          <div>📖 ${turma.nome} - ${turma.disciplinas[0]?.disciplina || 'Disciplina'}</div>
          <div class="turma-info">
            ${alunosFiltrados.length} aluno(s) | Média: ${mediaTurma} | ✅ ${aprovados} aprovado(s) (${percentual}%)
          </div>
        </div>
      `;
      turmaCard.appendChild(turmaHeader);

      const table = createStudentsTable(alunosFiltrados);
      turmaCard.appendChild(table);
      escolaCard.appendChild(turmaCard);
    }
    
    if (temTurmas) {
      container.appendChild(escolaCard);
    }
  }
  
  // Rodapé
  const footer = document.createElement('div');
  footer.className = 'footer';
  footer.innerHTML = `<p>Dashboard atualizado em ${new Date().toLocaleTimeString('pt-BR')}</p>`;
  container.appendChild(footer);
}

function createStudentsTable(alunos) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  thead.innerHTML = `
    <tr>
      <th>Matrícula</th>
      <th>Nome</th>
      <th>1º Tri</th>
      <th>2º Tri</th>
      <th>3º Tri</th>
      <th>Média Final</th>
      <th>Status</th>
    </tr>
  `;

  for (const aluno of alunos) {
    const row = document.createElement('tr');
    
    const nota1 = getNotaTexto(aluno.notas, '1° Trim');
    const nota2 = getNotaTexto(aluno.notas, '2° Trim');
    const nota3 = getNotaTexto(aluno.notas, '3° Trim');

    let statusTexto = '';
    let statusClass = '';
    
    if(nota1 !== '--' && nota2 !== '--' && nota3 !== '--'){
      statusTexto = '❌ Reprovado';
      statusClass = 'status-reprovado';
      if (aluno.mediaFinal >= 7) {
        statusTexto = '✅ Aprovado';
        statusClass = 'status-excellente';
      } else if (aluno.mediaFinal >= 5) {
        statusTexto = '⚠️ Recuperação';
        statusClass = 'status-recuperacao';
      }
    }
    

    row.innerHTML = `
      <td>${aluno.matricula}</td>
      <td><strong>${aluno.nome}</strong></td>
      <td>${nota1}</td>
      <td>${nota2}</td>
      <td>${nota3}</td>
      <td><span class="nota-badge ${getClasseBadge(aluno.mediaFinal)}">${aluno.mediaFinal.toFixed(1)}</span></td>
      <td><span class="${statusClass}">${statusTexto}</span></td>
    `;
    
    tbody.appendChild(row);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function getClasseBadge(media) {
  if (media >= 7) return 'badge-excelente';
  if (media >= 5) return 'badge-bom';
  return 'badge-ruim';
}

function getNotaTexto(lista, periodo) {
  if (!lista || lista.length === 0) return '--';
  
  const periodoLower = periodo.toLowerCase();
  
  for (const item of lista) {
    const trimestre = (item.trimestre || '').toLowerCase();
    if (trimestre.includes(periodoLower.split(' ')[0])) {
      return item.nota && item.nota !== '--' ? item.nota : '--';
    }
  }
  
  return '--';
}
