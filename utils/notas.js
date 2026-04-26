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
    let melhorNota = -1;

    for (const [chave, valor] of Object.entries(periodos)) {
      const matchTipo = chave.includes(tipo);
      const matchNum = chave.includes(numStr);
      const isER = chave.includes('er');

      if (matchTipo && matchNum && !isER) {
        melhorNota = Math.max(melhorNota, valor);
      }
    }

    return melhorNota;
  });
}

// ─── Cálculo de Média ───────────────────────────────────────────────

/**
 * Calcula a média final de um aluno baseado em sua lista de resultados
 * Suporta tanto sistema trimestral (3 trimestres) quanto semestral (EJA - 2 semestres)
 * 
 * @param {Array} listaResultados - Lista de resultados do aluno
 * @returns {number} Média final (1 casa decimal) ou 0 se incompleto
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
    if (sem1 < 0 || sem2 < 0) return 0;
    return parseFloat(((sem1 + sem2) / 2).toFixed(1));
  }
  
  // Se for TRIMESTRE (regular): média ponderada com pesos [3, 3, 4]
  const [trim1, trim2, trim3] = extrairNotasPorPeriodo(periodos, 'tri', [1, 2, 3]);
  if (trim1 < 0 || trim2 < 0 || trim3 < 0) return 0;

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
 * Retorna a classe CSS para o badge da nota.
 * @param {number} media 
 * @returns {string}
 */
function getClasseBadge(media) {
  if (media >= 6) return 'badge-excelente';
  if (media >= 5) return 'badge-bom';
  return 'badge-ruim';
}

/**
 * Classifica um valor de nota em uma categoria para filtragem.
 * @param {number|string} value 
 * @returns {'aprov'|'recup'|'reprov'|'semnota'}
 */
function getStatusCategory(value) {
  if (value === undefined || value === null || isNaN(value) || value === '--') return 'semnota';
  const val = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : value;
  if (val >= 6) return 'aprov';
  if (val >= 5) return 'recup';
  return 'reprov';
}

/**
 * Retorna o texto e classe CSS de status de um aluno.
 * @param {number} mediaFinal 
 * @param {boolean} hasGrades 
 * @returns {{ texto: string, classe: string }}
 */
function getAlunoStatus(mediaFinal, hasGrades) {
  if (!hasGrades) return { texto: '', classe: '' };
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
