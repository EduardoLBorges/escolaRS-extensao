/**
 * Lógica do Calendário e Registro de Chamadas
 */

let state = {
  currentDate: new Date(),
  selectedDate: new Date(),
  dadosBrutos: null, // Resultado do listarEscolasProfessor
  escolas: [],
  idRecHumano: null,
  token: null,
  nrDoc: null,
  mapaAulasPorDiaDaSemana: new Map(), // { 0: [...], 1: [...] } onde 0 = Domingo, 1 = Segunda
  mapaAulasPorDataEspecifica: new Map(), // { "YYYY-MM-DD": [...] }
  ignorados: {}, // { "YYYY-MM-DD": ["idTurma-idDisciplina"] }
  horariosCustomizados: [] // array de quadros
};

// --- Início: Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadData();
  renderCalendar();
  renderClassesForSelectedDay();
});

function setupEventListeners() {
  document.getElementById('btnVoltar').addEventListener('click', () => {
    window.location.href = '../dashboard/dashboard.html';
  });

  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() + 1);
    renderCalendar();
  });

  // Event Delegation para botões de presença e botões de envio (corrige erro CSP do Chrome)
  document.getElementById('classesList').addEventListener('click', (e) => {
    if (e.target.classList.contains('attendance-btn')) {
      const row = e.target.closest('.attendance-toggle');
      row.querySelectorAll('.attendance-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    }
    
    if (e.target.classList.contains('submit-attendance')) {
      const btn = e.target;
      submitAttendance(
        btn.dataset.formIndex,
        parseInt(btn.dataset.idTurma),
        parseInt(btn.dataset.idDisciplina),
        parseInt(btn.dataset.qtPeriodos),
        btn.dataset.dataStr,
        btn.dataset.idPeriodoAula,
        btn
      );
    }
    
    if (e.target.classList.contains('toggle-attendance-btn')) {
      const targetId = e.target.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
         if (targetEl.style.display === 'none') {
            targetEl.style.display = 'block';
            e.target.innerHTML = '🔼 Ocultar Alunos';
         } else {
            targetEl.style.display = 'none';
            e.target.innerHTML = '🔽 Mostrar Alunos';
         }
      }
    }
  });

  document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseModal').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('hidden');
    renderCalendar();
    renderClassesForSelectedDay();
  });
  document.getElementById('btnNewSchedule').addEventListener('click', showNewScheduleForm);
  document.getElementById('btnExport').addEventListener('click', exportSchedules);
  
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('btnImportFile').click());
  document.getElementById('btnImportFile').addEventListener('change', importSchedules);
  
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('form-action-btn')) {
      const action = e.target.dataset.action;
      if (action === 'fillWithApiSchedule') window.fillWithApiSchedule();
      else if (action === 'addScheduleRow') window.addScheduleRow();
      else if (action === 'saveNewSchedule') window.saveNewSchedule();
      else if (action === 'renderSchedulesList') renderSchedulesList();
      else if (action === 'removeTempRow') {
        const idx = parseInt(e.target.dataset.index);
        window.removeTempRow(idx);
      }
      else if (action === 'deleteSchedule') {
        const idx = parseInt(e.target.dataset.index);
        window.deleteSchedule(idx);
      }
      else if (action === 'editSchedule') {
        const idx = parseInt(e.target.dataset.index);
        window.editSchedule(idx);
      }
    }
  });
}

async function loadData() {
  setLoading(true, 'Carregando autenticação...');
  
  try {
    const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc", "escolaRsIgnorados", "escolaRsHorariosCustomizados"]);
    if (!authData.escolaRsToken || !authData.nrDoc) {
      throw new Error('Usuário não autenticado.');
    }
    
    state.token = authData.escolaRsToken;
    state.nrDoc = authData.nrDoc;
    state.ignorados = authData.escolaRsIgnorados || {};
    state.horariosCustomizados = authData.escolaRsHorariosCustomizados || [];
    
    setLoading(true, 'Buscando turmas e alunos...');
    // Busca dados com a API (do arquivo api/escolaRS.js incluído no HTML)
    const dados = await listarEscolasProfessor(state.nrDoc, state.token);
    state.dadosBrutos = dados;
    state.idRecHumano = dados.idRecHumano;
    state.escolas = dados.escolas || [];
    
    mapearAulasDaSemana();
    
    setLoading(false);
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados: ' + err.message, 'error');
    setLoading(false);
  }
}

// --- Fim: Inicialização ---

// --- Processamento de Dados ---
function mapearAulasDaSemana() {
    // Limpa mapas
  for (let i = 0; i <= 6; i++) {
    state.mapaAulasPorDiaDaSemana.set(i, []);
  }
  state.mapaAulasPorDataEspecifica.clear();

  state.escolas.forEach(escola => {
    escola.turmas.forEach(turma => {
      turma.disciplinas.forEach(disciplina => {
        
        // As aulas programadas para a semana (cenário normal)
        const listaAulas = disciplina.listaAulasNaTurmaDisciplina || [];
        listaAulas.forEach(aulaConfig => {
          const jsDay = aulaConfig.diaSemana - 1; 
          
          if (jsDay >= 0 && jsDay <= 6) {
            const arr = state.mapaAulasPorDiaDaSemana.get(jsDay);
            
            const existe = arr.find(a => a.disciplina.id === disciplina.id && a.turma.id === turma.id);
            if (existe) {
              existe.periodos.push(aulaConfig.periodoAula);
            } else {
              arr.push({
                escolaNome: escola.nome,
                idCalenEstab: aulaConfig.idCalenEstab || disciplina.chamadas?.[0]?.idCalenEstab || null,
                turma: turma,
                disciplina: disciplina,
                periodos: [aulaConfig.periodoAula]
              });
            }
          }
        });
        
        // Aulas do Histórico (Chamadas reais)
        const chamadas = disciplina.chamadas || [];
        chamadas.forEach(chamada => {
          const dataIso = chamada.data;
          
          if (!state.mapaAulasPorDataEspecifica.has(dataIso)) {
            state.mapaAulasPorDataEspecifica.set(dataIso, []);
          }
          
          const arr = state.mapaAulasPorDataEspecifica.get(dataIso);
          if (!arr.find(a => a.disciplina.id === disciplina.id && a.turma.id === turma.id)) {
            arr.push({
              escolaNome: escola.nome,
              idCalenEstab: chamada.idCalenEstab || null,
              turma: turma,
              disciplina: disciplina,
              periodos: chamada.qtPeriodos ? Array.from({length: chamada.qtPeriodos}, (_, i) => i+1) : [1],
              ehHistorico: true
            });
          }
        });
        
      });
    });
  });
}

// --- Regras de Validação de Datas de Aula ---
function isClassActiveOnDate(aulaConfig, dayDate) {
  const { turma } = aulaConfig;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  if (dayDate > today) return false;
  
  if (turma.dtInicioAtividade) {
    const [y, m, d] = turma.dtInicioAtividade.split('-');
    const dtInicio = new Date(y, m - 1, d);
    dtInicio.setHours(0,0,0,0);
    if (dayDate < dtInicio) return false;
  }
  
  if (turma.periodos && turma.periodos.length > 0) {
    let minDate = new Date(8640000000000000); 
    let maxDate = new Date(-8640000000000000);
    
    turma.periodos.forEach(p => {
      if (p.dataInicioPeriodo) {
        const [dd, mm, yyyy] = p.dataInicioPeriodo.split('/');
        const d = new Date(yyyy, mm - 1, dd);
        if (d < minDate) minDate = d;
      }
      if (p.dataFimPeriodo) {
        const [dd, mm, yyyy] = p.dataFimPeriodo.split('/');
        const d = new Date(yyyy, mm - 1, dd);
        d.setHours(23, 59, 59, 999);
        if (d > maxDate) maxDate = d;
      }
    });
    
    if (minDate !== new Date(8640000000000000) && dayDate < minDate) return false;
    if (maxDate !== new Date(-8640000000000000) && dayDate > maxDate) return false;
  }
  
  return true;
}

// --- Renderização do Calendário ---
function renderCalendar() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    
  document.getElementById('currentMonthYear').textContent = `${monthNames[month]} ${year}`;
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  const startDayOfWeek = firstDay.getDay(); 
  const totalDays = lastDay.getDate();
  
  const calendarDays = document.getElementById('calendarDays');
  calendarDays.innerHTML = '';
  
  // Preenche dias vazios iniciais
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'cal-day empty';
    calendarDays.appendChild(emptyDiv);
  }
  
  const today = new Date();
  
  // Preenche os dias do mês
  for (let d = 1; d <= totalDays; d++) {
    const currentIterDate = new Date(year, month, d);
    const dayOfWeek = currentIterDate.getDay();
    
    const dayDiv = document.createElement('div');
    dayDiv.className = 'cal-day';
    dayDiv.textContent = d;
    
    const isoDate = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    
    // Tem aula neste dia? 
    const customSchedule = getCustomScheduleForDate(isoDate);
    let aulasRegulares = [];
    
    if (customSchedule) {
      const customClasses = customSchedule.aulas.filter(a => a.diaSemana == dayOfWeek);
      customClasses.forEach(c => {
         const foundAulaConfig = buildAulaConfigFromIds(c.idTurma, c.idDisciplina);
         if (foundAulaConfig) {
             foundAulaConfig.periodos = c.periodos;
             aulasRegulares.push(foundAulaConfig);
         }
      });
    } else {
      const aulasDesteDiaSemana = state.mapaAulasPorDiaDaSemana.get(dayOfWeek) || [];
      aulasRegulares = aulasDesteDiaSemana.filter(aula => isClassActiveOnDate(aula, currentIterDate));
    }
    
    // Histórico de aulas específicas para esta data
    const aulasHistorico = state.mapaAulasPorDataEspecifica.get(isoDate) || [];
    
    // Mesclar sem duplicatas
    const aulasDoDiaMap = new Map();
    [...aulasRegulares, ...aulasHistorico].forEach(aula => {
      const ch = `${aula.turma.id}-${aula.disciplina.id}`;
      if (!aulasDoDiaMap.has(ch)) {
        aulasDoDiaMap.set(ch, aula);
      }
    });
    const aulasTotais = Array.from(aulasDoDiaMap.values());
    
    // Filtrar aulas ignoradas pelo usuário
    const ignoradosNoDia = state.ignorados[isoDate] || [];
    const aulasFiltradas = aulasTotais.filter(aula => !ignoradosNoDia.includes(`${aula.turma.id}-${aula.disciplina.id}`));
    
    // Hoje?
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
      dayDiv.classList.add('today');
    }
    
    // Selecionado?
    if (d === state.selectedDate.getDate() && month === state.selectedDate.getMonth() && year === state.selectedDate.getFullYear()) {
      dayDiv.classList.add('selected');
    }

    if (currentIterDate > today) {
      // Futuro fica disabled
      dayDiv.classList.add('disabled');
    } else {
      // É um dia válido para click, independente de ter aula ou não
      
      // Avalia Status (Completo/Pendente) se houver aulas
      if (aulasFiltradas.length > 0) {
        let registeredCount = 0;
        aulasFiltradas.forEach(aula => {
          const chamadas = aula.disciplina.chamadas || [];
          if (chamadas.find(c => c.data === isoDate)) {
            registeredCount++;
          }
        });
        
        if (registeredCount === aulasFiltradas.length) {
          dayDiv.classList.add('has-class-complete');
        } else {
          dayDiv.classList.add('has-class-pending');
        }
      }
      
      dayDiv.addEventListener('click', () => {
        document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
        dayDiv.classList.add('selected');
        
        state.selectedDate = new Date(year, month, d);
        renderClassesForSelectedDay();
      });
    }
    
    calendarDays.appendChild(dayDiv);
  }
}

// --- Renderização das Aulas do Dia Selecionado ---
function renderClassesForSelectedDay() {
  const container = document.getElementById('classesList');
  const jsDay = state.selectedDate.getDay();
  
  const dataStr = formatDate(state.selectedDate);
  document.getElementById('selectedDayTitle').innerHTML = `Aulas do dia <span class="text-primary">${dataStr}</span>`;
  
  const isoDate = formatDateIso(state.selectedDate);
  const customSchedule = getCustomScheduleForDate(isoDate);
  
  let aulasRegulares = [];
  if (customSchedule) {
      const customClasses = customSchedule.aulas.filter(a => a.diaSemana == jsDay);
      customClasses.forEach(c => {
         const foundAulaConfig = buildAulaConfigFromIds(c.idTurma, c.idDisciplina);
         if (foundAulaConfig) {
             foundAulaConfig.periodos = c.periodos;
             aulasRegulares.push(foundAulaConfig);
         }
      });
  } else {
      const rawAulas = state.mapaAulasPorDiaDaSemana.get(jsDay) || [];
      aulasRegulares = rawAulas.filter(aula => isClassActiveOnDate(aula, state.selectedDate));
  }
  
  const aulasHistorico = state.mapaAulasPorDataEspecifica.get(isoDate) || [];
  
  // Mesclar sem duplicatas
  const aulasDoDiaMap = new Map();
  [...aulasRegulares, ...aulasHistorico].forEach(aula => {
    const ch = `${aula.turma.id}-${aula.disciplina.id}`;
    if (!aulasDoDiaMap.has(ch)) {
      aulasDoDiaMap.set(ch, aula);
    }
  });
  
  const ignoradosNoDia = state.ignorados[isoDate] || [];
  const aulasFiltradas = Array.from(aulasDoDiaMap.values()).filter(aula => !ignoradosNoDia.includes(`${aula.turma.id}-${aula.disciplina.id}`));
  
  container.innerHTML = '';
  
  if (aulasFiltradas.length === 0) {
    container.innerHTML = '<p class="empty-state" style="margin-bottom: 20px;">Nenhuma aula programada ou pendente para este dia.</p>';
  } else {
    aulasFiltradas.forEach((aulaConfig, index) => {
      container.appendChild(createClassForm(aulaConfig, dataStr, index, isoDate));
    });
  }
  
  // Adiciona o botão de nova aula extra
  const btnExtra = document.createElement('button');
  btnExtra.className = 'btn btn-secondary';
  btnExtra.style.width = '100%';
  btnExtra.innerHTML = '➕ Adicionar Aula Manual';
  btnExtra.onclick = () => renderExtraClassForm(dataStr, isoDate);
  container.appendChild(btnExtra);
}

function formatDateIso(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
}

function renderExtraClassForm(dataStr, isoDate) {
  // Lógica para adicionar uma turma/disciplina específica será implementada a seguir
  // Por ora apenas emite um aviso ou constrói o combobox
  const container = document.getElementById('classesList');
  // Remove empty state and button to append form
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();
  
  const lastBtn = container.querySelector('.btn-secondary');
  if (lastBtn) lastBtn.remove();
  
  // Criar seletor
  const div = document.createElement('div');
  div.className = 'class-card extra-class-selector';
  
  let options = '<option value="">-- Selecione a Turma e Disciplina --</option>';
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      t.disciplinas.forEach(d => {
        options += `<option value="${t.id}|${d.id}">${e.nome} - ${t.nome} - ${d.nome}</option>`;
      });
    });
  });
  
  div.innerHTML = `
    <h3 style="margin-bottom: 15px;">Adicionar Aula Manual</h3>
    <div class="form-group">
      <select id="extraClassSelect" class="form-control">
        ${options}
      </select>
    </div>
    <div class="class-actions">
      <button class="btn btn-primary" onclick="confirmExtraClass('${dataStr}', '${isoDate}')">Continuar</button>
      <button class="btn btn-secondary" onclick="renderClassesForSelectedDay()">Cancelar</button>
    </div>
  `;
  container.appendChild(div);
}

window.confirmExtraClass = (dataStr, isoDate) => {
  const select = document.getElementById('extraClassSelect');
  if (!select.value) return;
  
  const [idTurma, idDisc] = select.value.split('|');
  
  const aulaConfig = buildAulaConfigFromIds(idTurma, idDisc);
  if (aulaConfig) {
    // Adiciona temporariamente ao mapa de data especifica para que seja renderizado
    if (!state.mapaAulasPorDataEspecifica.has(isoDate)) {
      state.mapaAulasPorDataEspecifica.set(isoDate, []);
    }
    state.mapaAulasPorDataEspecifica.get(isoDate).push(aulaConfig);
    renderClassesForSelectedDay();
  }
}

function createClassForm(aulaConfig, dataStr, index, isoDate) {
  const div = document.createElement('div');
  div.className = 'class-card';
  
  const { turma, disciplina, escolaNome, periodos } = aulaConfig;
  
  const [d, m, y] = dataStr.split('/');
  // isoDate is passed via param agora
  
  // Verifica se já existe chamada registrada
  let chamadaExistente = null;
  if (disciplina.chamadas && disciplina.chamadas.length > 0) {
    chamadaExistente = disciplina.chamadas.find(c => c.data === isoDate);
  }
  
  if (chamadaExistente) {
    div.classList.add('completed');
  }
  
  const matriculasComFalta = new Set(
    chamadaExistente && chamadaExistente.alunoFaltas 
      ? chamadaExistente.alunoFaltas.map(af => af.matricula) 
      : []
  );
  
  const registroConteudo = chamadaExistente ? chamadaExistente.registroConteudo : '';
  const textBtnEnvio = chamadaExistente ? "Atualizar Registro" : "Enviar Registro";
  const idPeriodoAulaExistente = chamadaExistente ? chamadaExistente.idPeriodoAulaData : "";
  
  const alunos = disciplina.alunosEAulas?.alunos?.filter(a => a.situacao.id === 1 || a.situacao.id === 2) || []; 
  
  alunos.sort((a, b) => (a.nroNaTurma || 0) - (b.nroNaTurma || 0));

  const formId = `form-${index}`;
  
  let studentsHtml = '';
  alunos.forEach(aluno => {
    const isFalta = matriculasComFalta.has(aluno.matricula);
    const clsPresente = isFalta ? "" : "active";
    const clsFalta = isFalta ? "active" : "";
    
    studentsHtml += `
      <div class="student-row" data-matricula="${aluno.matricula}">
        <div class="student-info">
          <span class="student-number" style="margin-right: 10px; font-weight: bold; width: 20px; display: inline-block;">${aluno.nroNaTurma || '-'}</span>
          <span class="student-name">${aluno.nome}</span>
        </div>
        <div class="attendance-toggle">
          <button type="button" class="attendance-btn present ${clsPresente}">Presente</button>
          <button type="button" class="attendance-btn absent ${clsFalta}">Falta</button>
        </div>
      </div>
    `;
  });
  
  const qtPeriodos = periodos.length || 1;

  div.innerHTML = `
    <div class="class-header" style="justify-content: flex-start; align-items: center; gap: 10px;">
      <div style="flex-grow: 1;">
        <h3 class="class-title">${turma.nome} - ${disciplina.nome}</h3>
        <p class="class-meta">${escolaNome} • ${qtPeriodos} Período(s): ${periodos.join(', ')}</p>
      </div>
      <button class="btn btn-secondary ignore-class-btn" data-id-turma="${turma.id}" data-id-disciplina="${disciplina.id}" data-iso-date="${isoDate}">Ignorar Pendência</button>
    </div>
    
    <div class="form-group">
      <label>Conteúdo da Aula</label>
      <textarea class="form-control" rows="3" id="conteudo-${index}" placeholder="Digite o conteúdo abordado ou observações...">${registroConteudo}</textarea>
    </div>
    
    <div class="form-group">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
         <label style="margin-bottom: 0;">Lista de Presença</label>
         <button class="btn btn-sm btn-secondary toggle-attendance-btn" data-target="students-${index}">🔽 Mostrar Alunos</button>
      </div>
      <div class="students-list" id="students-${index}" style="display: none;">
        ${studentsHtml}
      </div>
    </div>
    
    <div class="class-actions">
      <button class="btn btn-primary submit-attendance" 
        data-form-index="${index}" 
        data-id-turma="${turma.id}" 
        data-id-disciplina="${disciplina.id}" 
        data-qt-periodos="${qtPeriodos}" 
        data-data-str="${dataStr}"
        data-id-periodo-aula="${idPeriodoAulaExistente}">
        ${textBtnEnvio}
      </button>
    </div>
  `;
  
  return div;
}

// --- Interação do Formulário ---

window.submitAttendance = async (formIndex, idTurma, idDisciplina, qtPeriodos, dataStr, idPeriodoAulaExistente, btn) => {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  
  try {
    const conteudo = document.getElementById(`conteudo-${formIndex}`).value;
    const studentsContainer = document.getElementById(`students-${formIndex}`);
    const rows = studentsContainer.querySelectorAll('.student-row');
    
    const alunoFaltas = [];
    
    // Gerar arrays de faltas completos baseados no qtPeriodos (ex: [1], [1, 2], [1, 2, 3])
    const arrFaltas = Array.from({length: qtPeriodos}, (_, i) => i + 1);
    const faltasJustificadas = {};
    arrFaltas.forEach(f => faltasJustificadas[f.toString()] = false);
    
    rows.forEach(row => {
      const isAbsent = row.querySelector('.absent.active');
      const matricula = parseInt(row.dataset.matricula);
      
      if (isAbsent) {
        alunoFaltas.push({
          matricula: matricula,
          faltas: arrFaltas,
          faltasJustificadas: faltasJustificadas,
          ausenciaFisica: false
        });
      } else {
        alunoFaltas.push({
          matricula: matricula,
          ausenciaFisica: false
        });
      }
    });
    
    // Buscar chamadas existentes e dados para o payload
    // Na API, idCalenEstab e idSerie etc. Como construir?
    // Podemos tentar pegar da turma
    let turmaDados = state.escolas.flatMap(e=>e.turmas).find(t => t.id === idTurma);
    
    // Pegar o iso date (YYYY-MM-DD)
    const [d, m, y] = dataStr.split('/');
    const isoDate = `${y}-${m}-${d}`;
    
    const now = new Date();
    const dataVersaoLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    
    const payload = {
      idTurma: idTurma,
      idDisciplina: idDisciplina,
      idRecHumano: state.idRecHumano,
      idCalenEstab: 0, // A API pode aceitar zerado se não soubermos
      idCurso: turmaDados.idCurso || 0,
      idSerie: turmaDados.idSerie || 0,
      data: isoDate,
      qtPeriodos: qtPeriodos,
      registroConteudo: conteudo || "Aula",
      alunoFaltas: alunoFaltas,
      dataVersao: dataVersaoLocal,
      alunoAusenteFisicamente: [],
      ctrDthInc: "",
      ctrDthAtu: ""
    };
    
    if (idPeriodoAulaExistente) {
      payload.idPeriodoAulaData = parseInt(idPeriodoAulaExistente);
    }
    
    // Tenta arrumar o idCalenEstab
    try {
      const disc = turmaDados.disciplinas.find(d => d.id === idDisciplina);
      if (disc && disc.chamadas && disc.chamadas.length > 0) {
        payload.idCalenEstab = disc.chamadas[0].idCalenEstab;
      }
    } catch(e) {}
    
    console.log("Enviando payload:", payload);
    
    await registrarChamadaAula(
      idTurma, 
      idDisciplina, 
      isoDate, 
      state.idRecHumano, 
      payload, 
      state.token
    );
    
    showToast('Chamada registrada com sucesso!', 'success');
    
    // Atualiza imediatamente a visualização do Card para estado completo
    const card = btn.closest('.class-card');
    if (card) {
      card.classList.add('completed');
    }
    
    // Muda o texto original para não voltar para "Enviar Chamada"
    btn.textContent = 'Atualizar Registro';
    btn.disabled = false; // Permite re-enviar (atualizar) imediatamente sem refresh
    return; // Evita cair no caso de erro que restaura o texto antigo
  } catch (err) {
    console.error(err);
    showToast('Erro ao gravar: ' + err.message, 'error');
  }
  
  // O finally manual (apenas caso de erro executa para restaurar o disabled e o form)
  btn.disabled = false;
  btn.textContent = originalText;
};

  // Event Delegation para Ignore
  document.getElementById('classesList').addEventListener('click', async (e) => {
    if (e.target.classList.contains('ignore-class-btn')) {
      const btn = e.target;
      const isoDate = btn.dataset.isoDate;
      const key = `${btn.dataset.idTurma}-${btn.dataset.idDisciplina}`;
      
      if (!state.ignorados[isoDate]) {
        state.ignorados[isoDate] = [];
      }
      
      if (!state.ignorados[isoDate].includes(key)) {
        state.ignorados[isoDate].push(key);
        await chrome.storage.local.set({ escolaRsIgnorados: state.ignorados });
        showToast('Aula ignorada para essa data.', 'success');
        
        renderClassesForSelectedDay();
        renderCalendar(); // atualizar bolinhas do calendario
      }
    }
  });

// --- Utilidades ---
function setLoading(isLoading, text = '') {
  const loading = document.getElementById('loading');
  const calendarLayout = document.getElementById('calendarContainer');
  const textEl = document.getElementById('loadingText');
  
  if (isLoading) {
    loading.classList.remove('hidden');
    calendarLayout.classList.add('hidden');
    textEl.textContent = text;
  } else {
    loading.classList.add('hidden');
    calendarLayout.classList.remove('hidden');
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function formatDate(dateObj) {
  return `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
}

// --- Subsistema de Horários Customizados ---

function getCustomScheduleForDate(isoDate) {
  if (!state.horariosCustomizados || state.horariosCustomizados.length === 0) return null;
  // Ordena de forma decrescente pela data (do mais recente para o mais antigo)
  const sorted = [...state.horariosCustomizados].sort((a, b) => b.dataInicio.localeCompare(a.dataInicio));
  // O quadro vigente é o primeiro cuja data de início é menor ou igual à data consultada
  return sorted.find(h => h.dataInicio <= isoDate);
}

function buildAulaConfigFromIds(idTurma, idDisc) {
  let aulaConfig = null;
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      if (parseInt(t.id) === parseInt(idTurma)) {
        t.disciplinas.forEach(d => {
          if (parseInt(d.id) === parseInt(idDisc)) {
            aulaConfig = {
              escolaNome: e.nome,
              idCalenEstab: null,
              turma: t,
              disciplina: d,
              periodos: [1] // Default
            };
          }
        });
      }
    });
  });
  return aulaConfig;
}

// --- Modal Logic ---

function openSettingsModal() {
  document.getElementById('settingsModal').classList.remove('hidden');
  renderSchedulesList();
}

function renderSchedulesList() {
  const container = document.getElementById('schedulesList');
  document.getElementById('scheduleFormContainer').classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = '<h3 style="margin-bottom: 15px;">Quadros de Horários Ativos</h3>';
  
  if (!state.horariosCustomizados || state.horariosCustomizados.length === 0) {
    container.innerHTML += '<p class="empty-state">Nenhum quadro de horários configurado. O sistema usará o padrão sincronizado da Seduc.</p>';
    return;
  }
  
  state.horariosCustomizados.forEach((h, index) => {
    const div = document.createElement('div');
    div.className = 'schedule-item';
    
    let htmlGrid = '<div class="schedule-item-grid">';
    const daysStr = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    htmlGrid += '<table class="grid-table"><thead><tr><th>Dia</th><th>Turma/Disc</th><th>Períodos</th></tr></thead><tbody>';
    
    // Sort array by day
    h.aulas.sort((a,b) => a.diaSemana - b.diaSemana).forEach(a => {
       const conf = buildAulaConfigFromIds(a.idTurma, a.idDisciplina);
       if(conf) {
          htmlGrid += `<tr>
            <td>${daysStr[a.diaSemana]}</td>
            <td>${conf.turma.nome} - ${conf.disciplina.nome}</td>
            <td>${a.periodos.join(', ')}</td>
          </tr>`;
       }
    });
    
    htmlGrid += '</tbody></table></div>';
    
    div.innerHTML = `
      <div class="schedule-item-header">
        <span>${h.nome} (Vigente a partir de ${h.dataInicio.split('-').reverse().join('/')})</span>
        <div>
          <button class="btn btn-secondary form-action-btn" data-action="editSchedule" data-index="${index}">✏️ Editar</button>
          <button class="btn btn-danger form-action-btn" data-action="deleteSchedule" data-index="${index}">🗑️ Remover</button>
        </div>
      </div>
      ${htmlGrid}
    `;
    container.appendChild(div);
  });
}

window.deleteSchedule = async (index) => {
  if (confirm('Tem certeza que deseja remover este quadro de horário da sua extensão?')) {
    state.horariosCustomizados.splice(index, 1);
    await chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });
    renderSchedulesList();
  }
};

function showNewScheduleForm() {
  document.getElementById('schedulesList').classList.add('hidden');
  const container = document.getElementById('scheduleFormContainer');
  container.classList.remove('hidden');
  
  let options = '<option value="">-- Selecione Turma e Disciplina --</option>';
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      t.disciplinas.forEach(d => {
        options += `<option value="${t.id}|${d.id}">${e.nome} - ${t.nome} - ${d.nome}</option>`;
      });
    });
  });
  
  container.innerHTML = `
    <h3 style="margin-bottom: 20px;">Criar Novo Quadro de Horário</h3>
    <div style="display:flex; gap:15px; margin-top:15px;">
      <div class="form-group" style="flex:2;">
        <label>Nome do Semestre/Quadro</label>
        <input type="text" id="schNome" class="form-control" placeholder="Ex: Ajuste após paralisação">
      </div>
      <div class="form-group" style="flex:1;">
        <label>Início da Vigência</label>
        <input type="date" id="schDataInicio" class="form-control">
      </div>
      <div class="form-group" style="flex:1; display:flex; align-items:flex-end;">
        <button class="btn btn-secondary form-action-btn" data-action="fillWithApiSchedule" style="width:100%;" title="Puxa a grade atual sincronizada com o estado">⏬ Preencher com Grade Atual</button>
      </div>
    </div>
    
    <div class="form-grid-creator">
      <h4 style="margin-bottom: 10px;">Aulas da Grade Semanal</h4>
      <div class="grid-row-creator">
        <select id="schDia" class="form-control" style="width:130px;">
          <option value="1">Segunda-feira</option>
          <option value="2">Terça-feira</option>
          <option value="3">Quarta-feira</option>
          <option value="4">Quinta-feira</option>
          <option value="5">Sexta-feira</option>
          <option value="6">Sábado</option>
          <option value="0">Domingo</option>
        </select>
        <select id="schDisc" class="form-control" style="flex:1;">
          ${options}
        </select>
        <input type="text" id="schPeriodos" class="form-control" placeholder="Ex: 1, 2" title="Períodos separados por vírgula" style="width:120px;">
        <button class="btn btn-secondary form-action-btn" data-action="addScheduleRow">Adicionar</button>
      </div>
      
      <table class="grid-table" id="newScheduleTable">
        <thead>
          <tr><th>Dia da Semana</th><th>Disciplina</th><th>Períodos</th><th>Ação</th></tr>
        </thead>
        <tbody id="newScheduleBody">
           <tr><td colspan="4" style="text-align: center; color: #777;">Nenhuma aula vinculada ainda.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="class-actions" style="justify-content: flex-start; gap: 15px;">
      <button class="btn btn-primary form-action-btn" data-action="saveNewSchedule">Salvar Quadro Definitivo</button>
      <button class="btn btn-secondary form-action-btn" data-action="renderSchedulesList">Cancelar</button>
    </div>
  `;
  
  // Store temp rows
  window._tempScheduleRows = [];
  window._editingScheduleId = null;
  renderTempRows();
}

window.editSchedule = (index) => {
  const h = state.horariosCustomizados[index];
  showNewScheduleForm();
  
  document.getElementById('schNome').value = h.nome;
  document.getElementById('schDataInicio').value = h.dataInicio;
  
  window._tempScheduleRows = [];
  const daysStr = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  
  h.aulas.forEach(a => {
    const conf = buildAulaConfigFromIds(a.idTurma, a.idDisciplina);
    if(conf) {
      window._tempScheduleRows.push({
        diaSemana: a.diaSemana,
        idTurma: a.idTurma,
        idDisciplina: a.idDisciplina,
        periodos: [...a.periodos],
        nomeDisc: `${conf.escolaNome} - ${conf.turma.nome} - ${conf.disciplina.nome}`,
        nomeDia: daysStr[a.diaSemana]
      });
    }
  });
  
  window._editingScheduleId = h.id;
  renderTempRows();
};

function renderTempRows() {
  const tbody = document.getElementById('newScheduleBody');
  if(!tbody) return;
  tbody.innerHTML = '';
  
  if (window._tempScheduleRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #777;">Nenhuma aula vinculada ainda.</td></tr>';
    return;
  }
  
  window._tempScheduleRows.forEach((r, i) => {
    let selectHtml = `<select class="temp-row-dia form-control" data-index="${i}" style="width: 130px; padding: 4px;">
      <option value="1" ${r.diaSemana == 1 ? 'selected' : ''}>Segunda-feira</option>
      <option value="2" ${r.diaSemana == 2 ? 'selected' : ''}>Terça-feira</option>
      <option value="3" ${r.diaSemana == 3 ? 'selected' : ''}>Quarta-feira</option>
      <option value="4" ${r.diaSemana == 4 ? 'selected' : ''}>Quinta-feira</option>
      <option value="5" ${r.diaSemana == 5 ? 'selected' : ''}>Sexta-feira</option>
      <option value="6" ${r.diaSemana == 6 ? 'selected' : ''}>Sábado</option>
      <option value="0" ${r.diaSemana == 0 ? 'selected' : ''}>Domingo</option>
    </select>`;
    
    tbody.innerHTML += `<tr>
      <td>${selectHtml}</td>
      <td>${r.nomeDisc}</td>
      <td><input type="text" value="${r.periodos.join(', ')}" class="temp-row-periodos form-control" data-index="${i}" style="width: 80px; padding: 4px;" title="Edite os períodos aqui (separados por vírgula)"></td>
      <td><button class="btn btn-danger form-action-btn" data-action="removeTempRow" data-index="${i}">X</button></td>
    </tr>`;
  });
}

window.addScheduleRow = () => {
  const diaSel = document.getElementById('schDia');
  const discSel = document.getElementById('schDisc');
  const perInp = document.getElementById('schPeriodos').value.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  
  if (!discSel.value || perInp.length === 0) return alert('Por favor, selecione a disciplina e informe os períodos numéricos corretos (ex: 1, 2).');
  
  const [tId, dId] = discSel.value.split('|');
  window._tempScheduleRows.push({
    diaSemana: parseInt(diaSel.value),
    idTurma: parseInt(tId),
    idDisciplina: parseInt(dId),
    periodos: perInp,
    nomeDisc: discSel.options[discSel.selectedIndex].text,
    nomeDia: diaSel.options[diaSel.selectedIndex].text
  });
  renderTempRows();
};

window.removeTempRow = (idx) => {
  window._tempScheduleRows.splice(idx, 1);
  renderTempRows();
};

window.saveNewSchedule = async () => {
  const nome = document.getElementById('schNome').value;
  const dI = document.getElementById('schDataInicio').value;
  
  if (!nome || !dI) return alert('Preencha os campos de Nome e Data Inicial do Quadro.');
  if (window._tempScheduleRows.length === 0) return alert('Adicione pelo menos uma aula na grade desse quadro.');
  
  // Coletar as alterações nos inputs (Período e Dia da Semana)
  const periodInputs = document.querySelectorAll('.temp-row-periodos');
  const diaInputs = document.querySelectorAll('.temp-row-dia');
  
  periodInputs.forEach((inp, x) => {
    const idx = parseInt(inp.dataset.index);
    const per = inp.value.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    window._tempScheduleRows[idx].periodos = per;
    window._tempScheduleRows[idx].diaSemana = parseInt(diaInputs[x].value);
  });
  
  const targetId = window._editingScheduleId || Date.now().toString();
  
  const h = {
    id: targetId,
    nome: nome,
    dataInicio: dI,
    aulas: window._tempScheduleRows.map(r => ({
      idTurma: r.idTurma, idDisciplina: r.idDisciplina, diaSemana: r.diaSemana, periodos: r.periodos
    }))
  };
  
  if (window._editingScheduleId) {
    const idx = state.horariosCustomizados.findIndex(c => c.id === targetId);
    if(idx !== -1) state.horariosCustomizados[idx] = h;
  } else {
    state.horariosCustomizados.push(h);
  }
  
  await chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });
  showToast('Quadro salvo com sucesso!', 'success');
  window._editingScheduleId = null;
  renderSchedulesList();
};

function exportSchedules() {
  if (state.horariosCustomizados.length === 0) {
    alert("Não há horários customizados para exportar.");
    return;
  }
  const data = JSON.stringify(state.horariosCustomizados, null, 2);
  const blob = new Blob([data], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'horarios_customizados_escolaRs.json';
  a.click();
}

function importSchedules(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const arr = JSON.parse(e.target.result);
      if (Array.isArray(arr)) {
        state.horariosCustomizados = arr;
        await chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });
        showToast('Quadros importados com sucesso!', 'success');
        renderSchedulesList();
      } else {
         alert('Estrutura de arquivo inválida.');
      }
    } catch(err) {
      alert('Arquivo inválido ou corrompido.');
    }
    // reset input
    event.target.value = '';
  };
  reader.readAsText(file);
}

window.fillWithApiSchedule = () => {
   if (!confirm("Isso puxará toda a grade atual vinculada no sistema da Escola.\nAulas já adicionadas abaixo serão substituídas. Deseja continuar?")) return;
   
   window._tempScheduleRows = [];
   
   const daysStr = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
   
   // A API varre os JS Days (0 = Domingo, ..., 6 = Sábado)
   for (let jsDay = 0; jsDay <= 6; jsDay++) {
      const apiAulas = state.mapaAulasPorDiaDaSemana.get(jsDay) || [];
      apiAulas.forEach(aulaConfig => {
         window._tempScheduleRows.push({
            diaSemana: jsDay,
            idTurma: aulaConfig.turma.id,
            idDisciplina: aulaConfig.disciplina.id,
            periodos: [...aulaConfig.periodos],
            nomeDisc: `${aulaConfig.escolaNome} - ${aulaConfig.turma.nome} - ${aulaConfig.disciplina.nome}`,
            nomeDia: daysStr[jsDay]
         });
      });
   }
   
   const tbody = document.getElementById('newScheduleBody');
   tbody.innerHTML = '';
   
   if (window._tempScheduleRows.length === 0) {
     tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #777;">Nenhuma aula programada na Escola para você.</td></tr>';
     return;
   }
   
   window._tempScheduleRows.forEach((r, i) => {
      let selectHtml = `<select class="temp-row-dia form-control" data-index="${i}" style="width: 130px; padding: 4px;">
        <option value="1" ${r.diaSemana == 1 ? 'selected' : ''}>Segunda-feira</option>
        <option value="2" ${r.diaSemana == 2 ? 'selected' : ''}>Terça-feira</option>
        <option value="3" ${r.diaSemana == 3 ? 'selected' : ''}>Quarta-feira</option>
        <option value="4" ${r.diaSemana == 4 ? 'selected' : ''}>Quinta-feira</option>
        <option value="5" ${r.diaSemana == 5 ? 'selected' : ''}>Sexta-feira</option>
        <option value="6" ${r.diaSemana == 6 ? 'selected' : ''}>Sábado</option>
        <option value="0" ${r.diaSemana == 0 ? 'selected' : ''}>Domingo</option>
      </select>`;
      
      tbody.innerHTML += `<tr>
        <td>${selectHtml}</td>
        <td>${r.nomeDisc}</td>
        <td><input type="text" value="${r.periodos.join(', ')}" class="temp-row-periodos form-control" data-index="${i}" style="width: 80px; padding: 4px;"></td>
        <td><button class="btn btn-danger form-action-btn" data-action="removeTempRow" data-index="${i}">X</button></td>
      </tr>`;
   });
};
