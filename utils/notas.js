/**
 * Notas Module - Lógica de cálculo e processamento de notas
 * Responsável por regras de cálculo de médias e validação de notas
 */

/**
 * Normaliza uma string removendo diacríticos e símbolos especiais
 * @param {string} str - String a normalizar
 * @returns {string} String normalizada
 */
function normalizarString(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Obtém o valor de uma nota de uma lista de resultados
 * @param {Array} lista - Lista de resultados/notas
 * @param {string} periodo - Nome do período (trimestre, semestre, etc)
 * @returns {number} Valor da nota, ou -1 se não encontrado/inválido
 */
function getNotaValor(lista, periodo) {
  const periodoNormalizado = normalizarString(periodo);
  
  const item = lista.find(r => {
    const nomeNormalizado = normalizarString(r.nomePeriodo || r.trimestre || "");
    return nomeNormalizado === periodoNormalizado;
  });
  
  if (!item || item.resultado === "--" || item.resultado == null || item.nota === "--" || item.nota == null) {
    return -1;
  }
  
  const valor = item.resultado ?? item.nota;
  return parseFloat(String(valor).replace(",", "."));
}

/**
 * Calcula a média final de um aluno baseado em sua lista de resultados
 * Suporta tanto sistema trimestral (3 trimestres) quanto semestral (EJA - 2 semestres)
 * 
 * Fórmula trimestral: (T1*3 + T2*3 + T3*4) / 10
 * Fórmula semestral: (S1 + S2) / 2
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
    const nomePeriodo = (resultado.nomePeriodo || "").toLowerCase().trim();
    const valor = resultado.resultado;
    
    // Armazena apenas se o valor não é "-"
    if (valor && valor !== "--" && valor !== "-") {
      periodos[nomePeriodo] = parseFloat(String(valor).replace(",", "."));
      
      // Detectar tipo de período
      if (nomePeriodo.includes("trim")) temTrimestre = true;
      if (nomePeriodo.includes("sem")) temSemestre = true;
    }
  }
  
  // Se for SEMESTRE (EJA)
  if (temSemestre && !temTrimestre) {
    let sem1 = -1, sem2 = -1;
    
    // Procura pelos semestres
    for (const [chave, valor] of Object.entries(periodos)) {
      if (chave.includes("sem") && chave.includes("1") && !chave.includes("er")) {
        sem1 = Math.max(sem1, valor);
      }
      
      if (chave.includes("sem") && chave.includes("2") && !chave.includes("er")) {
        sem2 = Math.max(sem2, valor);
      }
    }
    
    // Se algum semestre não foi encontrado, retorna 0
    if (sem1 < 0 || sem2 < 0) {
      return 0;
    }
    
    // Fórmula para semestres: média simples
    const media = (sem1 + sem2) / 2;
    return parseFloat(media.toFixed(1));
  }
  
  // Se for TRIMESTRE (modalidade regular)
  let trim1 = -1, trim2 = -1, trim3 = -1;
  
  // Procura pelos padrões dos períodos (case-insensitive)
  for (const [chave, valor] of Object.entries(periodos)) {
    if (chave.includes("trim") && chave.includes("1") && !chave.includes("er")) {
      trim1 = Math.max(trim1, valor);
    } else if (chave.includes("1") && chave.includes("tri")) {
      trim1 = Math.max(trim1, valor);
    }
    
    if (chave.includes("trim") && chave.includes("2") && !chave.includes("er")) {
      trim2 = Math.max(trim2, valor);
    } else if (chave.includes("2") && chave.includes("tri")) {
      trim2 = Math.max(trim2, valor);
    }
    
    if (chave.includes("trim") && chave.includes("3") && !chave.includes("er")) {
      trim3 = Math.max(trim3, valor);
    } else if (chave.includes("3") && chave.includes("tri")) {
      trim3 = Math.max(trim3, valor);
    }
  }
  
  // Se algum trimestre não foi encontrado, retorna 0
  if (trim1 < 0 || trim2 < 0 || trim3 < 0) {
    return 0;
  }

  // Fórmula para trimestres: (T1*3 + T2*3 + T3*4) / 10
  const media = ((trim1 * 3) + (trim2 * 3) + (trim3 * 4)) / 10;
  return parseFloat(media.toFixed(1));
}

/**
 * Processa aluno adicionando cálculos de média e notas
 * @param {Object} aluno - Objeto do aluno com listaResultados
 * @returns {Object} Aluno com media e notas processadas
 */
function processarAluno(aluno) {
  return {
    ...aluno,
    mediaFinal: calcularMediaFinal(aluno.listaResultados || []),
    // Mapeia as notas para o formato esperado pelo dashboard
    notas: (aluno.listaResultados || []).map(res => ({
      trimestre: res.nomePeriodo,
      nota: res.resultado
    }))
  };
}
