/**
 * Lógica do Calendário e Registro de Chamadas
 */

let state = {
  currentDate: new Date(),
  selectedDate: new Date(),
  dadosBrutos: null,
  escolas: [],
  idRecHumano: null,
  token: null,
  nrDoc: null,
  mapaAulasPorDiaDaSemana: new Map(),
  mapaAulasPorDataEspecifica: new Map(),
  ignorados: {},
  horariosCustomizados: [],
  infrequentes: [],
  planosDeAula: [], // { id, disciplinaId, serie, aulas: [{ idAula, ordem, habilidade, estrategia, objetoConhecimento }] }
  viewFilters: { escola: '', turma: '' },
  isWeekView: false
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

  // Modal de Infrequentes
  document.getElementById('btnInfrequentes').addEventListener('click', openInfrequentesModal);
  document.getElementById('searchInfrequente').addEventListener('input', renderInfrequentesList);
  document.getElementById('btnCloseInfrequentesModal').addEventListener('click', () => {
    document.getElementById('infrequentesModal').classList.add('hidden');
    renderClassesForSelectedDay();
  });

  // Modal de Planos de Aula
  document.getElementById('btnPlanosAula').addEventListener('click', openPlanosModal);
  document.getElementById('btnClosePlanosModal').addEventListener('click', () => {
    document.getElementById('planosAulaModal').classList.add('hidden');
  });
  document.getElementById('btnNovoPlanoDisciplina').addEventListener('click', showPlanoForm);

  document.getElementById('listaTodosAlunos').addEventListener('change', async (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
      const mat = parseInt(e.target.dataset.matricula);
      if (e.target.checked) {
        if (!state.infrequentes.includes(mat)) {
          state.infrequentes.push(mat);
        }
      } else {
        state.infrequentes = state.infrequentes.filter(m => m !== mat);
      }
      await chrome.storage.local.set({ escolaRsInfrequentes: state.infrequentes });
    }
  });

  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('form-action-btn')) {
      const action = e.target.dataset.action;
      if (action === 'switchShiftTab') {
        window.switchShiftTab(e.target);
      }
      else if (action === 'saveNewSchedule') window.saveNewSchedule();
      else if (action === 'renderSchedulesList') renderSchedulesList();
      else if (action === 'deleteSchedule') {
        const idx = parseInt(e.target.dataset.index);
        window.deleteSchedule(idx);
      }
      else if (action === 'duplicateSchedule') {
        const idx = parseInt(e.target.dataset.index);
        window.duplicateSchedule(idx);
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
    const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc", "escolaRsIgnorados", "escolaRsHorariosCustomizados", "escolaRsInfrequentes", "escolaRsPlanosDeAula"]);
    if (!authData.escolaRsToken || !authData.nrDoc) {
      throw new Error('Usuário não autenticado.');
    }

    state.token = authData.escolaRsToken;
    state.nrDoc = authData.nrDoc;
    state.ignorados = authData.escolaRsIgnorados || {};
    state.horariosCustomizados = authData.escolaRsHorariosCustomizados || [];
    state.infrequentes = authData.escolaRsInfrequentes || [];
    state.planosDeAula = authData.escolaRsPlanosDeAula || [];

    setLoading(true, 'Buscando turmas e alunos...');
    // Busca dados com a API (do arquivo api/escolaRS.js incluído no HTML)
    const dados = await listarEscolasProfessor(state.nrDoc, state.token);
    state.dadosBrutos = dados;
    state.idRecHumano = dados.idRecHumano;
    state.escolas = dados.escolas || [];

    mapearAulasDaSemana();
    initViewFilters();

    setLoading(false);

    // Mostra barra de filtros se tudo der ok
    document.getElementById('filterContainer').classList.remove('hidden');
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
              periodos: chamada.qtPeriodos ? Array.from({ length: chamada.qtPeriodos }, (_, i) => i + 1) : [1],
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
    dtInicio.setHours(0, 0, 0, 0);
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

  const selectedStart = new Date(state.selectedDate);
  selectedStart.setDate(selectedStart.getDate() - selectedStart.getDay());
  selectedStart.setHours(0, 0, 0, 0);
  const selectedEnd = new Date(selectedStart);
  selectedEnd.setDate(selectedStart.getDate() + 6);
  selectedEnd.setHours(23, 59, 59, 999);

  const calendarDays = document.getElementById('calendarDays');
  calendarDays.innerHTML = '';

  // Preenche dias vazios iniciais
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyDate = new Date(year, month, i - startDayOfWeek + 1);
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'cal-day empty';
    if (state.isWeekView && emptyDate >= selectedStart && emptyDate <= selectedEnd) {
      emptyDiv.classList.add('selected');
    }
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

    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

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
    let aulasFiltradas = aulasTotais.filter(aula => !ignoradosNoDia.includes(`${aula.turma.id}-${aula.disciplina.id}`));

    // Filtros de View
    if (state.viewFilters.turma) {
      aulasFiltradas = aulasFiltradas.filter(a => a.turma?.nome === state.viewFilters.turma || (a.nomeDisc && a.nomeDisc.includes(state.viewFilters.turma)));
    }
    // Hoje?
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
      dayDiv.classList.add('today');
    }

    // Selecionado?
    if (state.isWeekView) {
      if (currentIterDate >= selectedStart && currentIterDate <= selectedEnd) {
        dayDiv.classList.add('selected');
      }
    } else {
      if (d === state.selectedDate.getDate() && month === state.selectedDate.getMonth() && year === state.selectedDate.getFullYear()) {
        dayDiv.classList.add('selected');
      }
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
        state.selectedDate = new Date(year, month, d);
        renderCalendar();
        renderClassesForSelectedDay();
      });
    }

    calendarDays.appendChild(dayDiv);
  }

  // Opcional: preencher os "emptys" finais para a visão da semana fechar redondinha se exceder o mes
  const lastDayOfWeek = lastDay.getDay(); // 0 a 6
  if (lastDayOfWeek < 6) {
    for (let i = 1; i <= 6 - lastDayOfWeek; i++) {
      const emptyDate = new Date(year, month + 1, i);
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'cal-day empty';
      if (state.isWeekView && emptyDate >= selectedStart && emptyDate <= selectedEnd) {
        emptyDiv.classList.add('selected');
      }
      calendarDays.appendChild(emptyDiv);
    }
  }
}

// --- Renderização das Aulas do Dia Selecionado ---
function renderClassesForSelectedDay() {
  const container = document.getElementById('classesList');
  container.innerHTML = '';

  if (state.isWeekView) {
    const selectedStart = new Date(state.selectedDate);
    selectedStart.setDate(selectedStart.getDate() - selectedStart.getDay());
    selectedStart.setHours(0, 0, 0, 0);
    const selectedEnd = new Date(selectedStart);
    selectedEnd.setDate(selectedStart.getDate() + 6);
    selectedEnd.setHours(23, 59, 59, 999);

    const titleStart = formatDate(selectedStart).slice(0, 5);
    const titleEnd = formatDate(selectedEnd);
    document.getElementById('selectedDayTitle').innerHTML = `Aulas da Semana <span class="text-primary">${titleStart} a ${titleEnd}</span>`;

    let curr = new Date(selectedStart);
    let todasAulasSemanas = [];

    while (curr <= selectedEnd) {
      const classesToRender = getClassesObjForDate(curr);
      if (classesToRender.length > 0) {
        const dataStr = formatDate(curr);
        const isoDate = formatDateIso(curr);

        classesToRender.forEach((aulaConfig) => {
          todasAulasSemanas.push({
            aulaConfig,
            dataStr,
            isoDate
          });
        });
      }
      curr.setDate(curr.getDate() + 1);
    }

    if (todasAulasSemanas.length === 0) {
      container.innerHTML = '<p class="empty-state">Nenhuma aula programada ou correspondente ao filtro para esta semana.</p>';
    } else {
      // Ordenação Alfabética e Numérica pelo Nome da Turma (Ex: Turma 101, Turma 102, Turma A)
      todasAulasSemanas.sort((a, b) => {
        const tA = a.aulaConfig.turma.nome || "";
        const tB = b.aulaConfig.turma.nome || "";
        const res = tA.localeCompare(tB, undefined, { numeric: true, sensitivity: 'base' });
        if (res !== 0) return res;
        return new Date(a.isoDate) - new Date(b.isoDate);
      });

      todasAulasSemanas.forEach((item, index) => {
        container.appendChild(createClassForm(item.aulaConfig, item.dataStr, index, item.isoDate));
      });
    }
  } else {
    const dataStr = formatDate(state.selectedDate);
    document.getElementById('selectedDayTitle').innerHTML = `Aulas do dia <span class="text-primary">${dataStr}</span>`;

    const classesToRender = getClassesObjForDate(state.selectedDate);
    const isoDate = formatDateIso(state.selectedDate);

    if (classesToRender.length === 0) {
      container.innerHTML = '<p class="empty-state">Nenhuma aula programada ou correspondente ao filtro para este dia.</p>';
    } else {
      classesToRender.forEach((aulaConfig, index) => {
        container.appendChild(createClassForm(aulaConfig, dataStr, index, isoDate));
      });
    }

    // Adiciona o botão de nova aula extra só na visão de dia
    const btnExtra = document.createElement('button');
    btnExtra.className = 'btn btn-secondary';
    btnExtra.style.width = '100%';
    btnExtra.innerHTML = '➕ Adicionar Aula Manual';
    btnExtra.onclick = () => renderExtraClassForm(dataStr, isoDate);
    container.appendChild(btnExtra);
  }
}

function getClassesObjForDate(dateObj) {
  const jsDay = dateObj.getDay();
  const isoDate = formatDateIso(dateObj);
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
    aulasRegulares = rawAulas.filter(aula => isClassActiveOnDate(aula, dateObj));
  }

  const aulasHistorico = state.mapaAulasPorDataEspecifica.get(isoDate) || [];

  const aulasDoDiaMap = new Map();
  [...aulasRegulares, ...aulasHistorico].forEach(aula => {
    const ch = `${aula.turma.id}-${aula.disciplina.id}`;
    if (!aulasDoDiaMap.has(ch)) aulasDoDiaMap.set(ch, aula);
  });

  const ignoradosNoDia = state.ignorados[isoDate] || [];
  const aulasFiltradas = Array.from(aulasDoDiaMap.values()).filter(aula => !ignoradosNoDia.includes(`${aula.turma.id}-${aula.disciplina.id}`));

  let classesToRender = [...aulasFiltradas];
  if (state.viewFilters.turma) {
    classesToRender = classesToRender.filter(c => c.turma?.nome === state.viewFilters.turma || (c.nomeDisc && c.nomeDisc.includes(state.viewFilters.turma)));
  }
  return classesToRender;
}


function formatDateIso(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
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

  alunos.sort((a, b) => {
    const nomeA = a.nomeAluno || a.nome || '';
    const nomeB = b.nomeAluno || b.nome || '';
    return nomeA.localeCompare(nomeB);
  });

  const formId = `form-${index}`;

  let studentsHtml = '';
  alunos.forEach(aluno => {
    const isInfrequente = state.infrequentes.includes(aluno.matricula);
    let isFalta = false;

    if (chamadaExistente) {
      isFalta = matriculasComFalta.has(aluno.matricula);
    } else {
      isFalta = isInfrequente;
    }

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

  // --- Slider de sugestões do Plano de Aula ---
  let sliderHtml = '';
  const planosDaTurmaDisc = (state.planosDeAula || []).filter(p =>
    String(p.disciplinaId) === String(disciplina.id) &&
    String(p.serie) === String(turma.idSerie)
  );
  const todasAulasDosPlanos = planosDaTurmaDisc.flatMap(p => p.aulas || []).sort((a, b) => a.ordem - b.ordem);
  if (todasAulasDosPlanos.length > 0) {
    const chips = todasAulasDosPlanos.map(aula => `
      <div class="plano-chip" 
           data-form-index="${index}" 
           data-habilidade="${(aula.habilidade || '').replace(/"/g, '&quot;')}" 
           data-estrategia="${(aula.estrategia || '').replace(/"/g, '&quot;')}"
           data-objeto="${(aula.objetoConhecimento || '').replace(/"/g, '&quot;')}"
           title="Estratégia: ${(aula.estrategia || '').replace(/"/g, '&quot;')}"
           role="button">
        <span class="plano-chip-num">Aula ${aula.ordem}</span>
        <span class="plano-chip-text">${aula.objetoConhecimento || '—'}</span>
      </div>
    `).join('');
    sliderHtml = `
      <div class="plano-sugestoes-wrapper">
        <span class="plano-sugestoes-label">💡 Sugestões do Plano</span>
        <div class="plano-chips-slider">${chips}</div>
      </div>
    `;
  }
  // --- Fim slider ---

  div.innerHTML = `
    <div class="class-header" style="justify-content: flex-start; align-items: center; gap: 10px;">
      <div style="flex-grow: 1;">
        <h3 class="class-title">${turma.nome} - ${disciplina.nome}</h3>
        <p class="class-meta">${escolaNome} • ${qtPeriodos} Período(s): ${periodos.join(', ')}</p>
      </div>
      <button class="btn btn-secondary ignore-class-btn" data-id-turma="${turma.id}" data-id-disciplina="${disciplina.id}" data-iso-date="${isoDate}">Ignorar Pendência</button>
    </div>
    ${sliderHtml}
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

  // Event Listener do slider (auto-fill)
  div.querySelectorAll('.plano-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const textarea = document.getElementById(`conteudo-${index}`);
      if (!textarea) return;
      const habilidade = chip.dataset.habilidade ? `Habilidade: ${chip.dataset.habilidade}\n` : '';
      const estrategia = chip.dataset.estrategia ? `Estratégia: ${chip.dataset.estrategia}\n` : '';
      const objeto = chip.dataset.objeto || '';
      textarea.value = `${objeto}\n${habilidade}${estrategia}`.trim();
      chip.classList.add('plano-chip--active');
      setTimeout(() => chip.classList.remove('plano-chip--active'), 600);
    });
  });
  // Drag-to-scroll no wrapper de sugestões
  const wrapper = div.querySelector('.plano-sugestoes-wrapper');
  if (wrapper) {
    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    wrapper.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.pageX - wrapper.offsetLeft;
      startScrollLeft = wrapper.scrollLeft;
      wrapper.classList.add('plano-grabbing');
      e.preventDefault(); // Evita selecionar texto durante o arraste
    });

    wrapper.addEventListener('mouseleave', () => {
      isDragging = false;
      wrapper.classList.remove('plano-grabbing');
    });

    wrapper.addEventListener('mouseup', () => {
      isDragging = false;
      wrapper.classList.remove('plano-grabbing');
    });

    wrapper.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.pageX - wrapper.offsetLeft;
      const walk = (x - startX) * 1.2; // Multiplicador de velocidade
      wrapper.scrollLeft = startScrollLeft - walk;
    });
  }

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
    const arrFaltas = Array.from({ length: qtPeriodos }, (_, i) => i + 1);
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
    let turmaDados = state.escolas.flatMap(e => e.turmas).find(t => t.id === idTurma);

    // Pegar o iso date (YYYY-MM-DD)
    const [d, m, y] = dataStr.split('/');
    const isoDate = `${y}-${m}-${d}`;

    const now = new Date();
    const dataVersaoLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

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
    } catch (e) { }

    console.log("Enviando payload:", payload);

    await registrarChamadaAula(
      idTurma,
      idDisciplina,
      isoDate,
      state.idRecHumano,
      payload,
      state.token
    );

    // Salvar localmente no state para persistir durante a mesma sessão sem F5
    const discToUpdate = turmaDados.disciplinas.find(d => d.id === idDisciplina);
    if (discToUpdate) {
      if (!discToUpdate.chamadas) discToUpdate.chamadas = [];

      let existing = discToUpdate.chamadas.find(c => c.data === isoDate);
      if (existing) {
        existing.alunoFaltas = alunoFaltas;
        existing.registroConteudo = conteudo;
      } else {
        discToUpdate.chamadas.push({
          data: isoDate,
          alunoFaltas: alunoFaltas,
          registroConteudo: conteudo,
          qtPeriodos: payload.periodos ? payload.periodos.length : payload.qtPeriodos
        });
      }

      mapearAulasDaSemana(); // Reconstrói os mapas do calendário e histórico com os novos dados
    }

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

  // Ordena por vigência (do mais recente para o mais antigo)
  state.horariosCustomizados.sort((a, b) => new Date(b.dataInicio) - new Date(a.dataInicio));
  chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });

  state.horariosCustomizados.forEach((h, index) => {
    const div = document.createElement('div');
    div.className = 'schedule-item';

    div.innerHTML = `
      <div class="schedule-item-header" style="display: flex; flex-direction: column; gap: 10px;">
        <span style="font-weight: 600; font-size: 1.1em; color: #2d3748;">${h.nome} <small style="font-weight: normal; color: #718096;">(Vigente a partir de ${h.dataInicio.split('-').reverse().join('/')})</small></span>
        <div class="class-actions" style="display: flex; gap: 10px; margin-top: 5px;">
          <button class="btn btn-secondary form-action-btn" data-action="duplicateSchedule" data-index="${index}">📑 Duplicar</button>
          <button class="btn btn-secondary form-action-btn" data-action="editSchedule" data-index="${index}">✏️ Editar</button>
          <button class="btn btn-danger form-action-btn" data-action="deleteSchedule" data-index="${index}">🗑️ Remover</button>
        </div>
      </div>
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

window.duplicateSchedule = async (index) => {
  const original = state.horariosCustomizados[index];
  const copy = JSON.parse(JSON.stringify(original)); // Deep copy

  copy.id = Date.now().toString();
  copy.nome = copy.nome + ' (Cópia)';

  state.horariosCustomizados.push(copy);
  await chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });

  showToast('Quadro duplicado com sucesso!', 'success');
  renderSchedulesList();
};

function showNewScheduleForm() {
  document.getElementById('schedulesList').classList.add('hidden');
  const container = document.getElementById('scheduleFormContainer');
  container.classList.remove('hidden');

  let options = '<option value="">-- Selecione Turma e Disciplina --</option>';
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      t.disciplinas.forEach(d => {
        options += `<option value="${t.id}|${d.id}">${t.nome} - ${e.nome} - ${d.nome}</option>`;
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
    </div>
    
    <div class="form-grid-creator" style="margin-top: 20px;">
      <h4 style="margin-bottom: 10px;">Quadro Semanal por Turno</h4>
      
      <div class="shift-tabs" style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">
        <button class="btn shift-tab-btn active form-action-btn" data-target="grid-M" data-action="switchShiftTab" style="flex:1;">☀️ Manhã</button>
        <button class="btn shift-tab-btn form-action-btn" data-target="grid-T" data-action="switchShiftTab" style="flex:1; background:#f1f5f9; color:#555;">🌤️ Tarde</button>
        <button class="btn shift-tab-btn form-action-btn" data-target="grid-N" data-action="switchShiftTab" style="flex:1; background:#f1f5f9; color:#555;">🌙 Noite</button>
      </div>
      
      ${['M', 'T', 'N'].map(shift => `
        <div id="grid-${shift}" class="shift-grid-container ${shift !== 'M' ? 'hidden' : ''}">
          <table class="grid-table template-schedule-grid" data-turno="${shift}" style="table-layout: fixed; width: 100%;">
            <thead>
              <tr style="font-size: 0.85rem;">
                <th style="width: 50px; text-align: center;">Período</th>
                <th>Segunda</th>
                <th>Terça</th>
                <th>Quarta</th>
                <th>Quinta</th>
                <th>Sexta</th>
              </tr>
            </thead>
            <tbody>
              ${[1, 2, 3, 4, 5, 6].map(per => `
                <tr>
                  <td style="text-align: center; font-weight: bold; background: #fafafa;">${per}º</td>
                  ${[1, 2, 3, 4, 5].map(day => `
                    <td style="padding: 2px;">
                      <select class="form-control schedule-cell-select" data-turno="${shift}" data-dia="${day}" data-periodo="${per}" style="width: 100%; padding: 4px; font-size: 0.75rem; border: 1px solid transparent; cursor: pointer; height: 100%;">
                        ${options}
                      </select>
                    </td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('')}
    </div>

    <div class="class-actions" style="justify-content: flex-start; gap: 15px; margin-top:20px;">
      <button class="btn btn-primary form-action-btn" data-action="saveNewSchedule">Salvar Quadro Definitivo</button>
      <button class="btn btn-secondary form-action-btn" data-action="renderSchedulesList">Cancelar</button>
    </div>
  `;

  window._editingScheduleId = null;
  // Limpar selections
  document.querySelectorAll('.schedule-cell-select').forEach(sel => sel.value = "");
}


window.switchShiftTab = (btn) => {
  // get all tabs, remove active
  document.querySelectorAll('.shift-tab-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = '#f1f5f9';
    b.style.color = '#555';
  });

  // activate target btn
  btn.classList.add('active');
  btn.style.background = '';
  btn.style.color = '';

  // hide all grids
  document.querySelectorAll('.shift-grid-container').forEach(g => g.classList.add('hidden'));
  // show target grid
  document.getElementById(btn.dataset.target).classList.remove('hidden');
};

window.editSchedule = (index) => {
  const h = state.horariosCustomizados[index];
  showNewScheduleForm();

  document.getElementById('schNome').value = h.nome;
  document.getElementById('schDataInicio').value = h.dataInicio;

  h.aulas.forEach(a => {
    const turno = a.turno || 'M';
    a.periodos.forEach(p => {
      const select = document.querySelector(`.schedule-cell-select[data-turno="${turno}"][data-dia="${a.diaSemana}"][data-periodo="${p}"]`);
      if (select) select.value = `${a.idTurma}|${a.idDisciplina}`;
    });
  });

  window._editingScheduleId = h.id;
};

window.saveNewSchedule = async () => {
  const nome = document.getElementById('schNome').value;
  const dI = document.getElementById('schDataInicio').value;

  if (!nome || !dI) return alert('Preencha os campos de Nome e Data Inicial do Quadro.');

  const aulas = [];

  ['M', 'T', 'N'].forEach(turno => {
    for (let day = 1; day <= 5; day++) {
      let lastVal = null;
      let currentPeriods = [];

      for (let p = 1; p <= 6; p++) {
        const sel = document.querySelector(`.schedule-cell-select[data-turno="${turno}"][data-dia="${day}"][data-periodo="${p}"]`);
        const val = sel ? sel.value : "";

        if (val === lastVal && val !== "") {
          currentPeriods.push(p);
        } else {
          if (lastVal) {
            const [idTurma, idDisciplina] = lastVal.split('|');
            aulas.push({
              turno: turno,
              diaSemana: day,
              idTurma: parseInt(idTurma),
              idDisciplina: parseInt(idDisciplina),
              periodos: currentPeriods
            });
          }
          lastVal = val;
          currentPeriods = val ? [p] : [];
        }
      }
      if (lastVal) {
        const [idTurma, idDisciplina] = lastVal.split('|');
        aulas.push({
          turno: turno,
          diaSemana: day,
          idTurma: parseInt(idTurma),
          idDisciplina: parseInt(idDisciplina),
          periodos: currentPeriods
        });
      }
    }
  });

  if (aulas.length === 0) return alert('Adicione pelo menos uma aula na grade desse quadro.');

  const targetId = window._editingScheduleId || Date.now().toString();

  const h = {
    id: targetId,
    nome: nome,
    dataInicio: dI,
    aulas: aulas
  };

  if (window._editingScheduleId) {
    const idx = state.horariosCustomizados.findIndex(c => c.id === targetId);
    if (idx !== -1) state.horariosCustomizados[idx] = h;
  } else {
    state.horariosCustomizados.push(h);
  }

  await chrome.storage.local.set({ escolaRsHorariosCustomizados: state.horariosCustomizados });
  showToast('Quadro salvo com sucesso!', 'success');
  window._editingScheduleId = null;
  renderSchedulesList();
};

function exportSchedules() {
  const config = {
    horariosCustomizados: state.horariosCustomizados || [],
    infrequentes: state.infrequentes || [],
    planosDeAula: state.planosDeAula || []
  };

  if (config.horariosCustomizados.length === 0 && config.infrequentes.length === 0 && config.planosDeAula.length === 0) {
    alert("Não há configurações para exportar.");
    return;
  }
  const data = JSON.stringify(config, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'configuracoes_escolaRs.json';
  a.click();
}

function importSchedules(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      // Retrocompatibilidade: Se for array, é um backup antigo de horários apenas
      if (Array.isArray(parsed)) {
        state.horariosCustomizados = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (parsed.horariosCustomizados) state.horariosCustomizados = parsed.horariosCustomizados;
        if (parsed.infrequentes) state.infrequentes = parsed.infrequentes;
        if (parsed.planosDeAula) state.planosDeAula = parsed.planosDeAula;
      } else {
        throw new Error('Formato inválido.');
      }

      await chrome.storage.local.set({
        escolaRsHorariosCustomizados: state.horariosCustomizados,
        escolaRsInfrequentes: state.infrequentes,
        escolaRsPlanosDeAula: state.planosDeAula
      });
      showToast('Configurações importadas com sucesso!', 'success');
      renderSchedulesList();
    } catch (err) {
      alert('Arquivo inválido ou corrompido: ' + err.message);
    }
    // reset input
    event.target.value = '';
  };
  reader.readAsText(file);
}

// --- Gestão de Alunos Infrequentes  ---
window.initViewFilters = () => {
  const trmSelect = document.getElementById('filterTurma');
  const btnClear = document.getElementById('btnClearFilters');

  // Obter todas as turmas de todas as escolas
  const turmas = [...new Set(state.escolas.flatMap(e => e.turmas.map(t => t.nome)))].sort();

  trmSelect.innerHTML = '<option value="">Nenhuma turma selecionada...</option>';
  turmas.forEach(t => {
    trmSelect.innerHTML += `<option value="${t}">${t}</option>`;
  });

  // Listeners
  trmSelect.addEventListener('change', (e) => {
    state.viewFilters.turma = e.target.value;
    if (state.viewFilters.turma) {
      btnClear.classList.remove('hidden');
    } else {
      btnClear.classList.add('hidden');
    }
    applyFiltersToViews();
  });

  btnClear.addEventListener('click', () => {
    trmSelect.value = '';
    state.viewFilters.turma = '';
    btnClear.classList.add('hidden');
    applyFiltersToViews();
  });

  const chkWeek = document.getElementById('chkWeekView');
  if (chkWeek) {
    chkWeek.addEventListener('change', (e) => {
      state.isWeekView = e.target.checked;
      applyFiltersToViews();
    });
  }
};

function applyFiltersToViews() {
  if (state.viewFilters.turma) {
    document.getElementById('calendarDays').style.opacity = '0.3';
    document.getElementById('calendarDays').style.pointerEvents = 'none';
    renderHistoricalClassesForTurma();
  } else {
    document.getElementById('calendarDays').style.opacity = '1';
    document.getElementById('calendarDays').style.pointerEvents = 'auto';
    renderCalendar();
    renderClassesForSelectedDay();
  }
}

function renderHistoricalClassesForTurma() {
  const container = document.getElementById('classesList');
  container.innerHTML = '';
  document.getElementById('selectedDayTitle').innerHTML = `Histórico Contínuo da Turma <span style="color:var(--primary)">${state.viewFilters.turma}</span>`;

  let foundTurma = null;
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      if (t.nome === state.viewFilters.turma) {
        foundTurma = t;
      }
    });
  });

  if (!foundTurma) return;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Data inicio do periodo letivo (ou fallback pra fevereiro do ano atual)
  let dtInicio = new Date(today.getFullYear(), 1, 1);
  if (foundTurma.dtInicioAtividade) {
    const [y, m, d] = foundTurma.dtInicioAtividade.split('-');
    dtInicio = new Date(y, m - 1, d);
  }

  const currDateIter = new Date(dtInicio);
  currDateIter.setHours(12, 0, 0, 0);

  let todasAulasHistoricas = [];

  while (currDateIter <= today) {
    const isoDate = `${currDateIter.getFullYear()}-${String(currDateIter.getMonth() + 1).padStart(2, '0')}-${String(currDateIter.getDate()).padStart(2, '0')}`;
    const dayOfWeek = currDateIter.getDay();
    const dataStr = currDateIter.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

    let aulasRegularesFallback = [];
    const customSchedule = getCustomScheduleForDate(isoDate);

    if (customSchedule) {
      const rs = customSchedule.aulas.filter(a => a.diaSemana == dayOfWeek && a.idTurma == foundTurma.id);
      rs.forEach(r => {
        const foundAulaconf = buildAulaConfigFromIds(r.idTurma, r.idDisciplina);
        if (foundAulaconf) {
          foundAulaconf.periodos = r.periodos;
          aulasRegularesFallback.push(foundAulaconf);
        }
      });
    } else {
      const diasSem = state.mapaAulasPorDiaDaSemana.get(dayOfWeek) || [];
      aulasRegularesFallback = diasSem.filter(a => a.turma.id === foundTurma.id && isClassActiveOnDate(a, currDateIter));
    }

    const historicoDataEspec = state.mapaAulasPorDataEspecifica.get(isoDate) || [];
    const aulasNesseDiaHistorico = historicoDataEspec.filter(a => a.turma.id === foundTurma.id);

    const aulasDoDiaMap = new Map();
    [...aulasRegularesFallback, ...aulasNesseDiaHistorico].forEach(aula => {
      const ch = `${aula.turma.id}-${aula.disciplina.id}`;
      if (!aulasDoDiaMap.has(ch)) aulasDoDiaMap.set(ch, aula);
    });

    const todasAsAulasDoDiaParaTurma = Array.from(aulasDoDiaMap.values());

    const ignoradosNoDia = state.ignorados[isoDate] || [];
    const validClasses = todasAsAulasDoDiaParaTurma.filter(aula => !ignoradosNoDia.includes(`${aula.turma.id}-${aula.disciplina.id}`));

    validClasses.forEach(c => {
      todasAulasHistoricas.push({ ...c, dataStr, isoDate });
    });

    currDateIter.setDate(currDateIter.getDate() + 1);
  }

  if (todasAulasHistoricas.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhuma aula encontrada para esta turma no intervalo até hoje.</p>';
    return;
  }

  todasAulasHistoricas.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));

  todasAulasHistoricas.forEach((item, idx) => {
    container.appendChild(createClassForm(item, item.dataStr, idx, item.isoDate));
  });
}

// --- Gestão de Alunos Infrequentes  ---
window.openInfrequentesModal = () => {
  document.getElementById('infrequentesModal').classList.remove('hidden');
  document.getElementById('searchInfrequente').value = '';

  const mapaAlunos = new Map();
  state.escolas.forEach(e => {
    e.turmas.forEach(t => {
      t.disciplinas.forEach(d => {
        const alunos = d.alunosEAulas?.alunos || [];
        alunos.forEach(a => {
          if (a.situacao.id === 1 || a.situacao.id === 2) {
            if (!mapaAlunos.has(a.matricula)) {
              mapaAlunos.set(a.matricula, { ...a, turmaNome: t.nome, escolaNome: e.nome });
            }
          }
        });
      });
    });
  });

  window._todosAlunosParaInfrequentes = Array.from(mapaAlunos.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  renderInfrequentesList();
};

window.renderInfrequentesList = () => {
  const list = document.getElementById('listaTodosAlunos');
  const q = document.getElementById('searchInfrequente').value.toLowerCase();

  // Agrupar alunos
  const agrupado = {};
  window._todosAlunosParaInfrequentes.forEach(a => {
    const textToSearch = `${a.nome.toLowerCase()} ${a.turmaNome.toLowerCase()} ${a.escolaNome.toLowerCase()}`;
    if (!q || textToSearch.includes(q)) {
      const nomeGrupo = `${a.turmaNome} - ${a.escolaNome}`;
      if (!agrupado[nomeGrupo]) agrupado[nomeGrupo] = [];
      agrupado[nomeGrupo].push(a);
    }
  });

  const chaves = Object.keys(agrupado).sort((a, b) => a.localeCompare(b));

  let html = '';
  if (chaves.length === 0) {
    html = '<p style="padding:15px; text-align:center; color:#888;">Nenhum aluno encontrado.</p>';
  } else {
    chaves.forEach((grupoName) => {
      const alunos = agrupado[grupoName];
      alunos.sort((a, b) => a.nome.localeCompare(b.nome));

      let studentsHtml = '';
      alunos.forEach(a => {
        const isChecked = state.infrequentes.includes(a.matricula) ? 'checked' : '';
        studentsHtml += `<label class="infrequente-item">
                     <input type="checkbox" data-matricula="${a.matricula}" ${isChecked}>
                     <div><strong>${a.nome}</strong></div>
                   </label>`;
      });

      // Se estiver pesquisando, abre todos os details que deram match
      const openAttr = q.length > 0 ? 'open' : '';
      html += `
          <details class="turma-group" ${openAttr}>
             <summary class="turma-group-summary">${grupoName} <span class="turma-badge">${alunos.length} Aluno(s)</span></summary>
             <div class="turma-group-content">
                ${studentsHtml}
             </div>
          </details>
        `;
    });
  }

  list.innerHTML = html;
};

// ===================================================
// --- GESTÃO DE PLANOS DE AULA ---
// ===================================================

function openPlanosModal() {
  document.getElementById('planosAulaModal').classList.remove('hidden');
  renderPlanosList();

  // Event Delegation para todos os botões do modal de Planos (CSP safe)
  const modal = document.getElementById('planosAulaModal');
  // Remove listener antigo para não duplicar
  if (modal._planosDelegate) modal.removeEventListener('click', modal._planosDelegate);
  modal._planosDelegate = async (e) => {
    const btn = e.target.closest('.plano-action-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    const planoId = btn.dataset.planoId;
    const aulaId = btn.dataset.aulaId;

    if (action === 'deleteAula') await deleteAulaDaPlano(planoId, aulaId);
    else if (action === 'showAddAulaForm') showAddAulaForm(planoId);
    else if (action === 'deletePlano') await deletePlano(planoId);
    else if (action === 'addAulaNaPlano') await addAulaNaPlano(planoId);
    else if (action === 'cancelAddAula') document.getElementById(`addAulaForm-${planoId}`).classList.add('hidden');
    else if (action === 'savePlano') await savePlano();
    else if (action === 'cancelPlanoForm') document.getElementById('planosFormContainer').classList.add('hidden');
  };
  modal.addEventListener('click', modal._planosDelegate);
}

function renderPlanosList() {
  const container = document.getElementById('planosListContainer');
  document.getElementById('planosFormContainer').classList.add('hidden');

  if (!state.planosDeAula || state.planosDeAula.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhum plano de aula criado ainda. Clique em "Novo Plano" para começar.</p>';
    return;
  }

  // Helper para buscar o label da série a partir do idSerie
  const getSerieLabel = (idSerie) => {
    for (const e of state.escolas) {
      for (const t of e.turmas) {
        if (String(t.idSerie) === String(idSerie)) {
          const cdS = t.cdSerie || idSerie;
          const tipoLabel = t.cdTipoEnsino === 'S2' ? 'EJA' : t.cdTipoEnsino === 'R2' ? 'Médio Regular' : (t.cdTipoEnsino || '');
          return tipoLabel ? `${cdS}ª Série - ${tipoLabel}` : `${cdS}ª Série`;
        }
      }
    }
    return `Série ${idSerie}`;
  };

  // Agrupar por disciplina
  const porDisc = {};
  state.planosDeAula.forEach(p => {
    const discObj = state.escolas.flatMap(e => e.turmas.flatMap(t => t.disciplinas)).find(d => String(d.id) === String(p.disciplinaId));
    const discNome = discObj ? discObj.nome : `Disciplina ${p.disciplinaId}`;
    if (!porDisc[discNome]) porDisc[discNome] = [];
    porDisc[discNome].push(p);
  });

  let html = '';
  Object.keys(porDisc).sort().forEach(discNome => {
    html += `<details class="plano-disc-group" open><summary class="plano-disc-summary">${discNome}</summary>`;

    // Agrupar por série dentro da disciplina
    const porSerie = {};
    porDisc[discNome].forEach(p => {
      if (!porSerie[p.serie]) porSerie[p.serie] = [];
      porSerie[p.serie].push(p);
    });

    Object.keys(porSerie).sort().forEach(serie => {
      const serieLabel = getSerieLabel(serie);
      porSerie[serie].forEach(plano => {
        const aulasSorted = [...(plano.aulas || [])].sort((a, b) => a.ordem - b.ordem);
        const aulaItems = aulasSorted.map(aula => `
          <div class="plano-aula-item" draggable="true" data-plano-id="${plano.id}" data-aula-id="${aula.idAula}" data-ordem="${aula.ordem}">
            <span class="plano-drag-handle" title="Arraste para reordenar">⠿</span>
            <div class="plano-aula-content">
              <strong>Aula ${aula.ordem}:</strong> ${aula.objetoConhecimento || '—'}
              ${aula.habilidade ? `<br><small><b>Habilidade:</b> ${aula.habilidade}</small>` : ''}
              ${aula.estrategia ? `<br><small><b>Estratégia:</b> ${aula.estrategia}</small>` : ''}
            </div>
            <button class="btn btn-sm btn-danger plano-action-btn" data-action="deleteAula" data-plano-id="${plano.id}" data-aula-id="${aula.idAula}">✕</button>
          </div>
        `).join('');

        html += `
          <details class="plano-serie-group" open>
            <summary class="plano-serie-summary">
              ${serieLabel}
              <div style="display:inline-flex;gap:6px;margin-left:10px;">
                <button class="btn btn-sm btn-primary plano-action-btn" data-action="showAddAulaForm" data-plano-id="${plano.id}">+ Aula</button>
                <button class="btn btn-sm btn-danger plano-action-btn" data-action="deletePlano" data-plano-id="${plano.id}">🗑️ Remover</button>
              </div>
            </summary>
            <div class="plano-aulas-list" id="aulasList-${plano.id}">
              ${aulaItems || '<p style="padding:10px;color:#888;">Nenhuma aula adicionada.</p>'}
            </div>
            <div id="addAulaForm-${plano.id}" class="plano-add-aula-form hidden" style="padding:15px;border-top:1px solid var(--border);">
              <div class="form-group">
                <label>Objeto do Conhecimento</label>
                <input type="text" id="novaAulaObjeto-${plano.id}" class="form-control" placeholder="Ex: Cinemática - Movimento Uniforme">
              </div>
              <div class="form-group">
                <label>Habilidade Trabalhada</label>
                <textarea id="novaAulaHabilidade-${plano.id}" class="form-control" rows="2" placeholder="Ex: Analisar e interpretar gráficos de posição..."></textarea>
              </div>
              <div class="form-group">
                <label>Estratégia Adotada</label>
                <textarea id="novaAulaEstrategia-${plano.id}" class="form-control" rows="2" placeholder="Ex: Aula expositiva com resolução de problemas..."></textarea>
              </div>
              <div class="class-actions" style="padding-top:8px;">
                <button class="btn btn-primary plano-action-btn" data-action="addAulaNaPlano" data-plano-id="${plano.id}">Adicionar Aula</button>
                <button class="btn btn-secondary plano-action-btn" data-action="cancelAddAula" data-plano-id="${plano.id}" style="margin-left:8px;">Cancelar</button>
              </div>
            </div>
          </details>
        `;
      });
    });
    html += '</details>';
  });

  container.innerHTML = html;
  setupDragAndDrop();
}

function showPlanoForm() {
  const container = document.getElementById('planosFormContainer');
  container.classList.remove('hidden');

  // Disciplinas únicas por id, ordenadas por nome
  const disciplinasMap = new Map();
  state.escolas.forEach(e => e.turmas.forEach(t => t.disciplinas.forEach(d => {
    if (!disciplinasMap.has(d.id)) disciplinasMap.set(d.id, d.nome);
  })));

  // Mapa de séries: idSerie -> { cdSerie, cdTipoEnsino, discIds: Set<discId> }
  const seriesMap = new Map();
  state.escolas.forEach(e => e.turmas.forEach(t => {
    const idSerie = t.idSerie;
    if (!idSerie) return;
    if (!seriesMap.has(idSerie)) {
      seriesMap.set(idSerie, {
        cdSerie: t.cdSerie || String(idSerie),
        cdTipoEnsino: t.cdTipoEnsino || '',
        discIds: new Set()
      });
    }
    t.disciplinas.forEach(d => seriesMap.get(idSerie).discIds.add(d.id));
  }));

  // Helper: formata o label da série
  const formatSerieLabel = (s) => {
    let tipoLabel = '';
    if (s.cdTipoEnsino === 'S2') tipoLabel = 'EJA';
    else if (s.cdTipoEnsino === 'R2') tipoLabel = 'Médio Regular';
    else if (s.cdTipoEnsino) tipoLabel = s.cdTipoEnsino;
    return tipoLabel ? `${s.cdSerie}ª Série - ${tipoLabel}` : `${s.cdSerie}ª Série`;
  };

  let discOptions = '<option value="">-- Selecione a disciplina --</option>';
  [...disciplinasMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, nome]) => {
    discOptions += `<option value="${id}">${nome}</option>`;
  });

  container.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;">
      <h3 style="margin-bottom:14px;">Novo Plano de Aula</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="form-group" style="flex:1;min-width:200px;">
          <label>Disciplina</label>
          <select id="novoPlanoDisc" class="form-control">${discOptions}</select>
        </div>
        <div class="form-group" style="flex:1;min-width:200px;">
          <label>Série</label>
          <select id="novoPlanoSerie" class="form-control">
            <option value="">-- Selecione a disciplina primeiro --</option>
          </select>
        </div>
      </div>
      <div class="class-actions" style="padding-top:8px;">
        <button class="btn btn-primary plano-action-btn" data-action="savePlano">Criar Plano</button>
        <button class="btn btn-secondary plano-action-btn" data-action="cancelPlanoForm" style="margin-left:8px;">Cancelar</button>
      </div>
    </div>
  `;

  // Listener: filtra as séries que possuem a disciplina selecionada
  document.getElementById('novoPlanoDisc').addEventListener('change', (ev) => {
    const discId = parseInt(ev.target.value);
    const serieSelect = document.getElementById('novoPlanoSerie');

    if (!discId) {
      serieSelect.innerHTML = '<option value="">-- Selecione a disciplina primeiro --</option>';
      return;
    }

    const seriesFiltradas = [...seriesMap.entries()]
      .filter(([, s]) => s.discIds.has(discId))
      .sort((a, b) => {
        if (a[1].cdTipoEnsino !== b[1].cdTipoEnsino) return a[1].cdTipoEnsino.localeCompare(b[1].cdTipoEnsino);
        return parseInt(a[1].cdSerie) - parseInt(b[1].cdSerie);
      });

    if (seriesFiltradas.length === 0) {
      serieSelect.innerHTML = '<option value="">Nenhuma série encontrada</option>';
      return;
    }

    serieSelect.innerHTML = '<option value="">-- Selecione a série --</option>';
    seriesFiltradas.forEach(([idSerie, s]) => {
      serieSelect.innerHTML += `<option value="${idSerie}">${formatSerieLabel(s)}</option>`;
    });
  });
}

window.savePlano = async () => {
  const discId = document.getElementById('novoPlanoDisc').value;
  const serie = document.getElementById('novoPlanoSerie').value;
  if (!discId || !serie) return alert('Selecione Disciplina e Série.');

  // Evitar duplicata
  const jaExiste = state.planosDeAula.find(p => String(p.disciplinaId) === String(discId) && String(p.serie) === String(serie));
  if (jaExiste) {
    showToast('Já existe um plano para essa disciplina/série.', 'error');
    return;
  }

  const novoPlano = {
    id: 'plano-' + Date.now(),
    disciplinaId: discId,
    serie: serie,
    aulas: []
  };

  state.planosDeAula.push(novoPlano);
  await chrome.storage.local.set({ escolaRsPlanosDeAula: state.planosDeAula });
  showToast('Plano criado! Adicione as aulas clicando em "+ Aula".', 'success');
  renderPlanosList();
};

window.showAddAulaForm = (planoId) => {
  document.getElementById(`addAulaForm-${planoId}`).classList.remove('hidden');
};

window.addAulaNaPlano = async (planoId) => {
  const objeto = document.getElementById(`novaAulaObjeto-${planoId}`).value.trim();
  const habilidade = document.getElementById(`novaAulaHabilidade-${planoId}`).value.trim();
  const estrategia = document.getElementById(`novaAulaEstrategia-${planoId}`).value.trim();

  const plano = state.planosDeAula.find(p => p.id === planoId);
  if (!plano) return;

  const maxOrdem = plano.aulas.reduce((max, a) => Math.max(max, a.ordem), 0);
  plano.aulas.push({
    idAula: 'aula-' + Date.now(),
    ordem: maxOrdem + 1,
    objetoConhecimento: objeto,
    habilidade: habilidade,
    estrategia: estrategia
  });

  await chrome.storage.local.set({ escolaRsPlanosDeAula: state.planosDeAula });
  showToast('Aula adicionada!', 'success');
  renderPlanosList();
};

window.deleteAulaDaPlano = async (planoId, aulaId) => {
  const plano = state.planosDeAula.find(p => p.id === planoId);
  if (!plano) return;
  plano.aulas = plano.aulas.filter(a => a.idAula !== aulaId);
  // Renumerar
  plano.aulas.sort((a, b) => a.ordem - b.ordem).forEach((a, i) => a.ordem = i + 1);
  await chrome.storage.local.set({ escolaRsPlanosDeAula: state.planosDeAula });
  renderPlanosList();
};

window.deletePlano = async (planoId) => {
  if (!confirm('Remover este plano e todas as suas aulas?')) return;
  state.planosDeAula = state.planosDeAula.filter(p => p.id !== planoId);
  await chrome.storage.local.set({ escolaRsPlanosDeAula: state.planosDeAula });
  showToast('Plano removido.', 'success');
  renderPlanosList();
};

function setupDragAndDrop() {
  document.querySelectorAll('.plano-aula-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        planoId: item.dataset.planoId,
        aulaId: item.dataset.aulaId
      }));
      item.classList.add('plano-item--dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('plano-item--dragging'));
    item.addEventListener('dragover', e => {
      e.preventDefault();
      item.classList.add('plano-item--dragover');
    });
    item.addEventListener('dragleave', () => item.classList.remove('plano-item--dragover'));
    item.addEventListener('drop', async e => {
      e.preventDefault();
      item.classList.remove('plano-item--dragover');
      const { planoId, aulaId: fromAulaId } = JSON.parse(e.dataTransfer.getData('text/plain'));
      const toAulaId = item.dataset.aulaId;
      if (fromAulaId === toAulaId || planoId !== item.dataset.planoId) return;

      const plano = state.planosDeAula.find(p => p.id === planoId);
      if (!plano) return;

      const fromAula = plano.aulas.find(a => a.idAula === fromAulaId);
      const toAula = plano.aulas.find(a => a.idAula === toAulaId);
      if (!fromAula || !toAula) return;

      // Swap de ordem
      const tempOrdem = fromAula.ordem;
      fromAula.ordem = toAula.ordem;
      toAula.ordem = tempOrdem;

      await chrome.storage.local.set({ escolaRsPlanosDeAula: state.planosDeAula });
      renderPlanosList();
    });
  });
}
