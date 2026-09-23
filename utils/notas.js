/**
 * Notas Module - Lógica de cálculo e processamento de notas
 * Responsável por regras de cálculo de médias e validação de notas
 */

// ─── Constantes ─────────────────────────────────────────────────────

const PESOS_TRIMESTRE = [3, 3, 4];
const SOMA_PESOS_TRIMESTRE = PESOS_TRIMESTRE.reduce((a, b) => a + b, 0);

// ─── Helpers de Período ─────────────────────────────────────────────

/**
 * Verifica se um valor de nota é válido (não vazio e não placeholder).
 * @param {*} valor
 * @returns {boolean}
 */
function isNotaValida(valor) {
  return valor && valor !== '--' && valor !== '-';
}

/**
 * Converte uma string de nota para número (tratando vírgula como separador decimal).
 * @param {*} valor
 * @returns {number}
 */
function parseNota(valor) {
  return parseFloat(String(valor).replace(',', '.'));
}

/**
 * Extrai as notas dos períodos a partir de um mapa de períodos.
 * Busca padrões como "1° trim", "trim 1", "1° sem", etc.
 *
 * @param {Object} periodos - Mapa { nomePeríodo: notaNumérica }
 * @param {string} tipo - Tipo de período para buscar ('trim' ou 'sem')
 * @param {number[]} indices - Índices dos períodos a buscar (ex: [1, 2, 3])
 * @returns {number[]} Array de notas encontradas (-1 para períodos não encontrados)
 */
function extrairNotasPorPeriodo(periodos, tipo, indices) {
  return indices.map((num) => {
    const numStr = String(num);
    let notaRegular = -1;
    let notaER = -1;

    for (const [chave, valor] of Object.entries(periodos)) {
      const matchTipo = chave.includes(tipo);
      const matchNum = chave.includes(numStr);
      const isER = chave.includes('er');

      if (matchNum) {
        if (isER) {
          notaER = Math.max(notaER, valor);
        } else if (matchTipo) {
          notaRegular = Math.max(notaRegular, valor);
        }
      }
    }

    // Se houver ER e nota regular, prevalece a maior
    if (notaRegular >= 0 && notaER >= 0) {
      return Math.max(notaRegular, notaER);
    }
    if (notaER >= 0) return notaER;
    return notaRegular;
  });
}

// ─── Cálculo de Média ───────────────────────────────────────────────

/**
 * Calcula a média final de um aluno baseado em sua lista de resultados
 * Suporta tanto sistema trimestral (3 trimestres) quanto semestral (EJA - 2 semestres)
 * 
 * @param {Array} listaResultados - Lista de resultados do aluno
 * @returns {number|null} Média final (1 casa decimal) ou null se incompleto
 */
function calcularMediaFinal(listaResultados) {
  // Cria um mapa dos períodos encontrados para fácil acesso
  const periodos = {};
  let temTrimestre = false;
  let temSemestre = false;
  
  for (const resultado of listaResultados) {
    const nomePeriodo = (resultado.nomePeriodo || '').toLowerCase().trim();
    const valor = resultado.resultado;
    
    if (isNotaValida(valor)) {
      periodos[nomePeriodo] = parseNota(valor);
      
      if (nomePeriodo.includes('trim')) temTrimestre = true;
      if (nomePeriodo.includes('sem')) temSemestre = true;
    }
  }
  
  // Se for SEMESTRE (EJA): média simples de 2 semestres
  if (temSemestre && !temTrimestre) {
    const [sem1, sem2] = extrairNotasPorPeriodo(periodos, 'sem', [1, 2]);
    if (sem1 < 0 || sem2 < 0) return null;
    return parseFloat(((sem1 + sem2) / 2).toFixed(1));
  }
  
  // Se for TRIMESTRE (regular): média ponderada com pesos [3, 3, 4]
  const [trim1, trim2, trim3] = extrairNotasPorPeriodo(periodos, 'tri', [1, 2, 3]);
  if (trim1 < 0 || trim2 < 0 || trim3 < 0) return null;

  const media = (trim1 * PESOS_TRIMESTRE[0] + trim2 * PESOS_TRIMESTRE[1] + trim3 * PESOS_TRIMESTRE[2]) / SOMA_PESOS_TRIMESTRE;
  return parseFloat(media.toFixed(1));
}

// ─── Processamento de Aluno ─────────────────────────────────────────

/**
 * Processa aluno adicionando cálculos de média e notas
 * @param {Object} aluno - Objeto do aluno com listaResultados
 * @returns {Object} Aluno com media e notas processadas
 */
function processarAluno(aluno) {
  const listaResultados = aluno.listaResultados || [];

  return {
    ...aluno,
    mediaFinal: calcularMediaFinal(listaResultados),
    // Mapeia as notas para o formato esperado pelo dashboard
    notas: listaResultados.map((res) => ({
      trimestre: res.nomePeriodo,
      nota: res.resultado,
    })),
  };
}

/**
 * Verifica se o aluno possui notas registradas em todos os períodos necessários (3 trimestres ou 2 semestres).
 * @param {Object|Array} alunoOuNotas - Objeto aluno ou array de notas
 * @param {boolean} [isSemestre=false]
 * @returns {boolean}
 */
function temNotasCompletas(alunoOuNotas, isSemestre = false) {
  const notas = Array.isArray(alunoOuNotas) ? alunoOuNotas : (alunoOuNotas?.notas || []);
  if (!notas || notas.length === 0) return false;

  if (isSemestre) {
    const s1 = getNotaTexto(notas, '1° Sem');
    const s2 = getNotaTexto(notas, '2° Sem');
    return s1 !== '--' && s2 !== '--';
  }

  const t1 = getNotaTexto(notas, '1° Trim');
  const t2 = getNotaTexto(notas, '2° Trim');
  const t3 = getNotaTexto(notas, '3° Trim');
  return t1 !== '--' && t2 !== '--' && t3 !== '--';
}

/**
 * Calcula a nota mínima necessária no período de fechamento (3° Trimestre ou 2° Semestre)
 * para que o aluno alcance a média final mínima para aprovação (>= 6,0).
 *
 * Para o sistema trimestral (pesos 3, 3, 4 com soma 10):
 *   (T1 * 3 + T2 * 3 + T3 * 4) / 10 >= 6.0
 *   T3 >= (60 - 3 * (T1 + T2)) / 4
 *
 * Para o sistema semestral (EJA, média simples):
 *   (S1 + S2) / 2 >= 6.0
 *   S2 >= 12 - S1
 *
 * @param {Object|Array} alunoOuNotas - Objeto aluno ou array de notas
 * @param {string} periodo - Nome do período clicado (ex: "3° Trim", "2° Sem")
 * @returns {{
 *   aplicavel: boolean,
 *   pendente: boolean,
 *   valorExato: number|null,
 *   formatada: string,
 *   status: 'garantido'|'exame'|'normal'|'pendente',
 *   atingiu: boolean|null
 * }|null}
 */
function calcularNotaMinimaPeriodo(alunoOuNotas, periodo) {
  const notas = Array.isArray(alunoOuNotas) ? alunoOuNotas : (alunoOuNotas?.notas || []);
  if (!notas || !periodo) return null;

  const periodoLower = periodo.toLowerCase();
  const isSemestre = periodoLower.includes('sem');
  const isTrimestre = periodoLower.includes('trim');
  const numMatch = periodoLower.match(/\d+/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[0], 10);

  // Apenas aplicável ao período final (3° Trimestre ou 2° Semestre)
  if (isTrimestre && num === 3) {
    const t1Str = getNotaTexto(notas, '1° Trim');
    const t2Str = getNotaTexto(notas, '2° Trim');

    if (t1Str === '--' || t2Str === '--') {
      return {
        aplicavel: true,
        pendente: true,
        valorExato: null,
        formatada: '--',
        status: 'pendente',
        atingiu: null,
      };
    }

    const t1 = parseFloat(t1Str.replace('*', '').replace(',', '.'));
    const t2 = parseFloat(t2Str.replace('*', '').replace(',', '.'));
    if (isNaN(t1) || isNaN(t2)) {
      return {
        aplicavel: true,
        pendente: true,
        valorExato: null,
        formatada: '--',
        status: 'pendente',
        atingiu: null,
      };
    }

    // Fórmula dos pesos [3, 3, 4] com soma 10 e média 6,0:
    // (t1 * 3 + t2 * 3 + t3 * 4) / 10 >= 6.0 => t3 >= (60 - 3 * (t1 + t2)) / 4
    const minNecessario = (60 - 3 * (t1 + t2)) / 4;
    return montarResultadoNotaMinima(minNecessario, notas, periodo);
  }

  if (isSemestre && num === 2) {
    const s1Str = getNotaTexto(notas, '1° Sem');
    if (s1Str === '--') {
      return {
        aplicavel: true,
        pendente: true,
        valorExato: null,
        formatada: '--',
        status: 'pendente',
        atingiu: null,
      };
    }

    const s1 = parseFloat(s1Str.replace('*', '').replace(',', '.'));
    if (isNaN(s1)) {
      return {
        aplicavel: true,
        pendente: true,
        valorExato: null,
        formatada: '--',
        status: 'pendente',
        atingiu: null,
      };
    }

    // Fórmula semestral (média simples / 2 >= 6.0 => s2 >= 12 - s1)
    const minNecessario = 12 - s1;
    return montarResultadoNotaMinima(minNecessario, notas, periodo);
  }

  return null;
}

function montarResultadoNotaMinima(minNecessario, notas, periodo) {
  let status = 'normal';
  let formatada = '';

  if (minNecessario <= 0) {
    status = 'garantido';
    formatada = '0,0';
  } else if (minNecessario > 10) {
    status = 'exame';
    formatada = '> 10,0';
  } else {
    // Se for inteiro ou tiver até 1 casa decimal (ex: 4.5, 6.0)
    if (minNecessario % 1 === 0 || (minNecessario * 10) % 1 === 0) {
      formatada = minNecessario.toFixed(1).replace('.', ',');
    } else {
      // Se tiver 2 casas decimais (ex: 3.75, 1.25)
      formatada = minNecessario.toFixed(2).replace('.', ',');
    }
  }

  // Verifica se a nota do período já foi lançada e se atingiu a nota mínima
  const notaPeriodoStr = getNotaTexto(notas, periodo);
  let atingiu = null;
  if (notaPeriodoStr !== '--') {
    const notaAtual = parseFloat(notaPeriodoStr.replace('*', '').replace(',', '.'));
    if (!isNaN(notaAtual)) {
      if (minNecessario <= 0) {
        atingiu = true;
      } else {
        // Tolerância de aproximação de 1 casa decimal para o fechamento
        atingiu = (notaAtual >= minNecessario || parseFloat(notaAtual.toFixed(1)) >= parseFloat(minNecessario.toFixed(1)));
      }
    }
  }

  return {
    aplicavel: true,
    pendente: false,
    valorExato: minNecessario,
    formatada,
    status,
    atingiu,
  };
}

/**
 * Retorna a classe CSS para o badge da nota.
 * @param {number|null} media 
 * @returns {string}
 */
function getClasseBadge(media) {
  if (media === null || media === undefined || isNaN(media)) return '';
  if (media >= 6) return 'badge-excelente';
  if (media >= 5) return 'badge-bom';
  return 'badge-ruim';
}

/**
 * Classifica um valor de nota em uma categoria para filtragem.
 * @param {number|string|null} value 
 * @returns {'aprov'|'recup'|'reprov'|'semnota'}
 */
function getStatusCategory(value) {
  if (value === undefined || value === null || isNaN(value) || value === '--') return 'semnota';
  const val = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value;
  if (isNaN(val)) return 'semnota';
  if (val >= 6) return 'aprov';
  if (val >= 5) return 'recup';
  return 'reprov';
}

/**
 * Retorna o texto e classe CSS de status de um aluno.
 * @param {number|null} mediaFinal 
 * @param {boolean} hasGrades 
 * @returns {{ texto: string, classe: string }}
 */
function getAlunoStatus(mediaFinal, hasGrades) {
  if (!hasGrades || mediaFinal === null || mediaFinal === undefined || isNaN(mediaFinal)) {
    return { texto: '', classe: '' };
  }
  if (mediaFinal >= 6) return { texto: 'Aprovado', classe: 'status-excellente' };
  if (mediaFinal >= 5) return { texto: 'Recuperação', classe: 'status-recuperacao' };
  return { texto: 'Reprovado', classe: 'status-reprovado' };
}

/**
 * Detecta o tipo de período (Trimestre/Semestre) e os números dos períodos existentes.
 * @param {Array} alunos 
 * @returns {{ isSemestre: boolean, periodos: string[] }}
 */
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

/**
 * Normaliza um valor de nota para exibição (ex: 6.5 -> "6,5").
 * @param {any} valor 
 * @returns {string}
 */
function normalizarNota(valor) {
  if (!valor || valor === '--') return '--';
  const numValor = parseFloat(String(valor).replace(',', '.'));
  if (isNaN(numValor)) return '--';
  return numValor.toFixed(1).replace('.', ',');
}

/**
 * Retorna o texto da nota para um determinado período, considerando Exame de Recuperação (ER).
 * @param {Array} lista - Lista de notas
 * @param {string} periodo - Nome do período (ex: "1° Trim")
 * @returns {string}
 */
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

    if (((isSemestre && itemEhSemestre) || (isTrimestre && itemEhTrimestre)) &&
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

/**
 * Retorna o valor bruto da nota para exportação.
 * @param {Array} lista 
 * @param {string} periodo 
 * @param {boolean} isER 
 * @returns {string}
 */
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
      if (((isSemestre && itemEhSemestre) || (isTrimestre && itemEhTrimestre)) &&
        nomePeriodo.includes(numPeriodo) && !nomePeriodo.includes('er')) {
        return item.nota && item.nota !== '--' ? normalizarNota(item.nota) : '--';
      }
    }
  }
  return '--';
}
