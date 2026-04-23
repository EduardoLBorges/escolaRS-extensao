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
