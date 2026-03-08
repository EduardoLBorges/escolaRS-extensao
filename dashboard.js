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
    <h3>Erro ao carregar dados</h3>
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
        <h3>Total de Alunos</h3>
        <div class="value">${stats.totalAlunos}</div>
      </div>
      <div class="stat-card">
        <h3>Escolas</h3>
        <div class="value">${dashboardData.escolas.length}</div>
      </div>
      <div class="stat-card">
        <h3>Média Geral</h3>
        <div class="value">${stats.mediaGeral}</div>
        <div class="sublabel">de 0 a 10</div>
      </div>
      <div class="stat-card">
        <h3>Acima de 6.0</h3>
        <div class="value">${stats.aprovados}</div>
        <div class="sublabel">${stats.percentualAprovados}%</div>
      </div>
    </div>
  `;
  
  container.insertAdjacentHTML('afterbegin', statsHtml);

  // Renderizar escolas, turmas e disciplinas
  for (const escola of dashboardData.escolas) {
    const escolaCard = document.createElement('div');
    escolaCard.className = 'escola-card';
    
    const escolaHeader = document.createElement('div');
    escolaHeader.className = 'escola-header';
    escolaHeader.innerHTML = `<span>${escola.nome}</span><span style="font-size: 13px; opacity: 0.9;">${escola.turmas.length} turma(s)</span>`;
    escolaCard.appendChild(escolaHeader);

    for (const turma of escola.turmas) {
      // Iterar sobre TODAS as disciplinas da turma
      for (const disc of turma.disciplinas) {
        const alunos = disc.alunos || [];
        const disciplina = disc.disciplina || 'Disciplina';
        
        if (alunos.length === 0) continue;
        
        const turmaCard = document.createElement('div');
        turmaCard.className = 'turma-card';
        
        const mediaTurma = (alunos.reduce((acc, a) => acc + (a.mediaFinal || 0), 0) / alunos.length).toFixed(1);
        const aprovados = alunos.filter(a => a.mediaFinal >= 6).length;
        const percentual = ((aprovados / alunos.length) * 100).toFixed(0);

        const turmaHeader = document.createElement('div');
        turmaHeader.className = 'turma-header';
        turmaHeader.innerHTML = `
          <div style="flex: 1;">
            <div>${turma.nome} - ${disciplina}</div>
            <div class="turma-info">
              ${alunos.length} alunos | Média: ${mediaTurma} | ${aprovados} aprovados (${percentual}%)
            </div>
          </div>
        `;
        turmaCard.appendChild(turmaHeader);

        const table = createStudentsTable(alunos);
        turmaCard.appendChild(table);
        escolaCard.appendChild(turmaCard);
      }
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
            if (aluno.mediaFinal >= 6) aprovados++;
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
  
  escolaControl.innerHTML = '<label>Escola</label>';
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
  
  turmaControl.innerHTML = '<label>Turma</label>';
  turmaControl.appendChild(turmaSelect);
  
  // Busca por Aluno
  const alunoControl = document.createElement('div');
  alunoControl.className = 'control-group';
  const alunoInput = document.createElement('input');
  alunoInput.type = 'text';
  alunoInput.id = 'filter-aluno';
  alunoInput.placeholder = 'Digite o nome...';
  
  alunoControl.innerHTML = '<label>Buscar Aluno</label>';
  alunoControl.appendChild(alunoInput);
  
  // Botão de limpar filtros
  const clearControl = document.createElement('div');
  clearControl.className = 'control-group';
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-filters';
  clearBtn.className = 'clearfilters';
  clearBtn.textContent = 'Limpar Filtros';
  
  clearControl.innerHTML = '<label>&nbsp;</label>';
  clearControl.appendChild(clearBtn);
  
  // Botão de exportar XLSX
  const exportControl = document.createElement('div');
  exportControl.className = 'control-group';
  const exportBtn = document.createElement('button');
  exportBtn.id = 'export-xlsx';
  exportBtn.className = 'clearfilters';
  exportBtn.textContent = 'Exportar XLSX';
  exportBtn.style.background = '#4caf50';
  
  exportControl.innerHTML = '<label>&nbsp;</label>';
  exportControl.appendChild(exportBtn);
  
  controlsDiv.appendChild(escolaControl);
  controlsDiv.appendChild(turmaControl);
  controlsDiv.appendChild(alunoControl);
  controlsDiv.appendChild(clearControl);
  controlsDiv.appendChild(exportControl);
  
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
  
  exportBtn.addEventListener('click', () => {
    const escolaSelecionada = document.getElementById('filter-escola')?.value || '';
    const turmaSelecionada = document.getElementById('filter-turma')?.value || '';
    const alunoFiltro = document.getElementById('filter-aluno')?.value?.toLowerCase() || '';
    exportarXLSX(escolaSelecionada, turmaSelecionada, alunoFiltro);
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
  if (turmaSelect) {
    // Atualizar opções de turma baseado na escola selecionada
    updateTurmaFilter(escolaSelecionada, turmaSelect);
    turmaSelect.value = turmaSelecionada;
  }
  if (alunoInput) {
    alunoInput.value = alunoFiltro;
    // Manter o cursor no campo de busca
    alunoInput.focus();
  }
  
  // Recriar stats
  const stats = calculateStats(dashboardData);
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <h3>Total de Alunos</h3>
        <div class="value">${stats.totalAlunos}</div>
      </div>
      <div class="stat-card">
        <h3>Escolas</h3>
        <div class="value">${dashboardData.escolas.length}</div>
      </div>
      <div class="stat-card">
        <h3>Média Geral</h3>
        <div class="value">${stats.mediaGeral}</div>
        <div class="sublabel">de 0 a 10</div>
      </div>
      <div class="stat-card">
        <h3>Acima de 6.0</h3>
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
    escolaHeader.innerHTML = `<span>${escola.nome}</span>`;
    escolaCard.appendChild(escolaHeader);

    let temTurmas = false;

    for (const turma of escola.turmas) {
      if (turmaSelecionada && turma.nome !== turmaSelecionada) continue;

      // Iterar sobre TODAS as disciplinas da turma
      for (const disc of turma.disciplinas) {
        const alunos = disc.alunos || [];
        const alunosFiltrados = alunos.filter(a => a.nome.toLowerCase().includes(alunoFiltro));
        
        if (alunosFiltrados.length === 0) continue;
        
        temTurmas = true;
        const turmaCard = document.createElement('div');
        turmaCard.className = 'turma-card';

        const mediaTurma = alunosFiltrados.length > 0 
          ? (alunosFiltrados.reduce((acc, a) => acc + (a.mediaFinal || 0), 0) / alunosFiltrados.length).toFixed(1)
          : 0;
        const aprovados = alunosFiltrados.filter(a => a.mediaFinal >= 6).length;
        const percentual = alunosFiltrados.length > 0 ? ((aprovados / alunosFiltrados.length) * 100).toFixed(0) : 0;

        const turmaHeader = document.createElement('div');
        turmaHeader.className = 'turma-header';
        turmaHeader.innerHTML = `
          <div style="flex: 1;">
            <div>${turma.nome} - ${disc.disciplina || 'Disciplina'}</div>
            <div class="turma-info">
              ${alunosFiltrados.length} aluno(s) | Média: ${mediaTurma} | ${aprovados} aprovado(s) (${percentual}%)
            </div>
          </div>
        `;
        turmaCard.appendChild(turmaHeader);

        const table = createStudentsTable(alunosFiltrados);
        turmaCard.appendChild(table);
        escolaCard.appendChild(turmaCard);
      }
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
  
  // Detectar tipo de período (trimestre ou semestre)
  const tipoAndPeriodos = detectarTipoEPeriodos(alunos);
  const periodos = tipoAndPeriodos.periodos;
  
  // Montar cabeçalhos dinamicamente
  let headerHTML = `
    <tr>
      <th>Matrícula</th>
      <th>Nome</th>`;
  
  for (const periodo of periodos) {
    headerHTML += `<th>${periodo}</th>`;
  }
  
  headerHTML += `
      <th>Média Final</th>
      <th>Status</th>
    </tr>
  `;
  
  thead.innerHTML = headerHTML;

  for (const aluno of alunos) {
    const row = document.createElement('tr');
    
    // Obter notas para cada período dinamicamente
    const notasPeriodos = periodos.map(periodo => getNotaTexto(aluno.notas, periodo));
    const todasAsNotasPreenchidas = notasPeriodos.every(nota => nota !== '--');

    let statusTexto = '';
    let statusClass = '';
    
    if(todasAsNotasPreenchidas){
      statusTexto = 'Reprovado';
      statusClass = 'status-reprovado';
      if (aluno.mediaFinal >= 6) {
        statusTexto = 'Aprovado';
        statusClass = 'status-excellente';
      } else if (aluno.mediaFinal >= 5) {
        statusTexto = 'Recuperação';
        statusClass = 'status-recuperacao';
      }
    }
    
    // Montar células de notas dinamicamente
    let rowHTML = `
      <td>${aluno.matricula}</td>
      <td><strong>${aluno.nome}</strong></td>`;
    
    for (const nota of notasPeriodos) {
      rowHTML += `<td>${nota}</td>`;
    }
    
    rowHTML += `
      <td><span class="nota-badge ${getClasseBadge(aluno.mediaFinal)}">${aluno.mediaFinal.toFixed(1)}</span></td>
      <td><span class="${statusClass}">${statusTexto}</span></td>
    `;
    
    row.innerHTML = rowHTML;
    tbody.appendChild(row);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function getClasseBadge(media) {
  if (media >= 6) return 'badge-excelente';
  if (media >= 5) return 'badge-bom';
  return 'badge-ruim';
}

function detectarTipoEPeriodos(alunos) {
  // Analisar todos os períodos disponíveis
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
      
      // Extrair o número
      const numMatch = nomePeriodo.match(/\d+/);
      if (numMatch) {
        periodosSet.add(numMatch[0]);
      }
    }
  }
  
  // Determinar tipo e criar lista de períodos ordenados
  const isSemestre = temSemestre && !temTrimestre;
  const tipo = isSemestre ? 'Sem' : 'Trim';
  const numeros = Array.from(periodosSet).map(Number).sort((a, b) => a - b);
  
  const periodos = numeros.map(num => {
    if (isSemestre) {
      return `${num}° Sem`;
    } else {
      return `${num}° Trim`;
    }
  });
  
  return { isSemestre, periodos };
}

function getNotaTexto(lista, periodo) {
  if (!lista || lista.length === 0) return '--';
  
  const periodoLower = periodo.toLowerCase();
  
  // Extrai o número do período (1, 2, 3, etc.)
  const numMatch = periodoLower.match(/\d+/);
  if (!numMatch) return '--';
  
  const numPeriodo = numMatch[0];
  const isSemestre = periodoLower.includes('sem');
  const isTrimestre = periodoLower.includes('trim');
  
  // Busca o valor do período principal
  let periodoValor = null;
  for (const item of lista) {
    const nomePeriodo = (item.trimestre || item.nomePeriodo || '').toLowerCase();
    if (!nomePeriodo) continue;
    
    // Verifica se é o mesmo tipo de período
    const itemEhSemestre = nomePeriodo.includes('sem');
    const itemEhTrimestre = nomePeriodo.includes('trim');
    
    // Se procura semestre, deveria encontrar semestre (e vice-versa)
    if ((isSemestre && itemEhSemestre || isTrimestre && itemEhTrimestre) && 
        nomePeriodo.includes(numPeriodo) && !nomePeriodo.includes('er')) {
      if (item.nota && item.nota !== '--') {
        periodoValor = item.nota;
        break;
      }
    }
  }
  
  // Busca o valor do ER (se for trimestre) ou recuperação equivalente
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
  
  // Ambos nulos
  if (periodoValor === null && erValor === null) return '--';
  
  // Apenas ER existe
  if (periodoValor === null) return `${erValor}*`;
  
  // Apenas período existe
  if (erValor === null) return periodoValor;
  
  // Ambos existem - retorna o máximo com indicação se for ER
  const periodoNum = parseFloat(String(periodoValor).replace(',', '.'));
  const erNum = parseFloat(String(erValor).replace(',', '.'));
  
  if (erNum > periodoNum) {
    return `${erValor}*`; // Asterisco indica que é ER
  }
  
  return periodoValor;
}

function exportarXLSX(escolaSelecionada, turmaSelecionada, alunoFiltro) {
  const wb = XLSX.utils.book_new();
  let temDados = false;
  
  // Coletar dados por turma e criar uma aba para cada
  for (const escola of dashboardData.escolas) {
    if (escolaSelecionada && escola.nome !== escolaSelecionada) continue;
    
    for (const turma of escola.turmas) {
      if (turmaSelecionada && turma.nome !== turmaSelecionada) continue;
      
      // Coletar todos os alunos da turma para detectar tipo de período
      let todosOsAlunos = [];
      for (const disc of turma.disciplinas) {
        todosOsAlunos = todosOsAlunos.concat(disc.alunos || []);
      }
      
      if (todosOsAlunos.length === 0) continue;
      
      // Detectar tipo e períodos
      const tipoAndPeriodos = detectarTipoEPeriodos(todosOsAlunos);
      const periodos = tipoAndPeriodos.periodos;
      const isSemestre = tipoAndPeriodos.isSemestre;
      
      const dados = [];
      
      // Montar cabeçalho dinamicamente
      const cabecalho = ['Matrícula', 'Nome'];
      for (const periodo of periodos) {
        cabecalho.push(periodo);
        // Se não for semestre, adiciona coluna para ER
        if (!isSemestre) {
          const numMatch = periodo.match(/\d+/);
          if (numMatch) {
            cabecalho.push(`ER${numMatch[0]}`);
          }
        }
      }
      cabecalho.push('Disciplina', 'Média Final', 'Status');
      dados.push(cabecalho);
      
      let temAlunosTurma = false;
      
      for (const disc of turma.disciplinas) {
        const alunos = disc.alunos || [];
        const alunosFiltrados = alunos.filter(a => a.nome.toLowerCase().includes(alunoFiltro));
        
        for (const aluno of alunosFiltrados) {
          temAlunosTurma = true;
          temDados = true;
          
          const linha = [
            aluno.matricula || '',
            aluno.nome || ''
          ];
          
          // Adicionar notas para cada período
          for (const periodo of periodos) {
            const notaPeriodo = getNotaValorBruto(aluno.notas, periodo, false);
            linha.push(notaPeriodo);
            
            // Se não for semestre, adiciona ER
            if (!isSemestre) {
              const notaER = getNotaValorBruto(aluno.notas, periodo, true);
              linha.push(notaER);
            }
          }
          
          let status = 'Sem Notas';
          if (aluno.mediaFinal > 0) {
            if (aluno.mediaFinal >= 6) status = 'Aprovado';
            else if (aluno.mediaFinal >= 5) status = 'Recuperação';
            else status = 'Reprovado';
          }
          
          linha.push(
            disc.disciplina || '',
            aluno.mediaFinal > 0 ? aluno.mediaFinal.toFixed(1) : '--',
            status
          );
          
          dados.push(linha);
        }
      }
      
      // Se essa turma tem alunos, criar uma aba para ela
      if (temAlunosTurma && dados.length > 1) {
        const nomeAba = turma.nome.substring(0, 31); // Excel limita a 31 caracteres
        const ws = XLSX.utils.aoa_to_sheet(dados);
        
        // Calcular largura das colunas dinamicamente
        const colWidths = [
          { wch: 12 }, // Matrícula
          { wch: 25 }  // Nome
        ];
        
        // Adicionar largura para períodos e ERs
        for (const periodo of periodos) {
          colWidths.push({ wch: 10 }); // Período
          if (!isSemestre) {
            colWidths.push({ wch: 8 }); // ER
          }
        }
        
        colWidths.push(
          { wch: 20 }, // Disciplina
          { wch: 12 }, // Média Final
          { wch: 15 }  // Status
        );
        
        ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, nomeAba);
      }
    }
  }
  
  // Se não houver dados, avisar
  if (!temDados) {
    alert('Nenhum dado para exportar com os filtros selecionados.');
    return;
  }
  
  // Fazer download
  const nomeArquivo = `${dashboardData.professor.replace(' ', '_')}_notas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, nomeArquivo);
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
    
    // Verificar tipo de período (semestre ou trimestre)
    const itemEhSemestre = nomePeriodo.includes('sem');
    const itemEhTrimestre = nomePeriodo.includes('trim');
    
    if (isER) {
      if (nomePeriodo.includes('er') && nomePeriodo.includes(numPeriodo)) {
        return item.nota && item.nota !== '--' ? item.nota : '--';
      }
    } else {
      // Procurar período principal (sem ER)
      if ((isSemestre && itemEhSemestre || isTrimestre && itemEhTrimestre) && 
          nomePeriodo.includes(numPeriodo) && !nomePeriodo.includes('er')) {
        return item.nota && item.nota !== '--' ? item.nota : '--';
      }
    }
  }
  
  return '--';
}
