/**
 * FiltroParser Module - Motor de busca inteligente e combinada para alunos e notas
 *
 * Suporta:
 * - Filtros por período: t1 < 6, t2 >= 8, s1 < 6 (trimestres/semestres)
 * - Filtros por recuperação: rec1 > 6, er2 < 6, rec > 6, rec < trim
 * - Comparação entre campos: rec1 > t1, er2 >= t2
 * - Média final: media < 6, med >= 7
 * - Status geral: status:aprov, status:recup, status:reprov, aprov, recup, reprov
 * - Situação cadastral: ativo, inativo, status:ativo
 * - Pendências de notas: semnota, pendente, t1:vazio, t1=--, sem:rec1, tem:rec1
 * - Projeção de aprovação (3º Trim / 2º Sem): precisa:garantido, precisa:exame, precisa <= 4
 * - Alertas de inconsistência: alerta:er (nota de ER lançada sem nota regular)
 * - Intervalos numéricos: t1: 4..6, 4 <= t1 <= 6
 * - Número de chamada: num <= 15, n: 10
 * - Negação: !aprov, not t1 < 6, -inativo
 * - Disjunção (OU): t1 < 6 or t2 < 6, rec1 < 6 ou rec2 < 6
 * - Busca textual e Regex: joão, silva, /^maria/i
 */

(function (global) {
  'use strict';

  /**
   * Normaliza uma string removendo acentos e convertendo para minúsculas.
   * @param {string} str
   * @returns {string}
   */
  function normalizeStr(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Extrai e mapeia todos os campos e notas de um aluno para facilitar a avaliação do filtro.
   * @param {Object} aluno
   * @param {string[]} [periodos] - Ex: ['1° Trim', '2° Trim', '3° Trim']
   * @param {boolean} [isSemestre=false]
   * @returns {Object|null}
   */
  function extrairValoresAluno(aluno, periodos, isSemestre) {
    if (!aluno) return null;

    if (!periodos || periodos.length === 0) {
      if (typeof detectarTipoEPeriodos === 'function') {
        const det = detectarTipoEPeriodos([aluno]);
        periodos = det.periodos;
        isSemestre = det.isSemestre;
      } else {
        periodos = ['1° Trim', '2° Trim', '3° Trim'];
        isSemestre = false;
      }
    }

    const nomeOriginal = aluno.nome || '';
    const nomeNorm = normalizeStr(nomeOriginal);
    const matricula = String(aluno.matricula || '').trim();
    const numero = !isNaN(parseInt(aluno.nroNaTurma, 10)) ? parseInt(aluno.nroNaTurma, 10) : null;
    const isAtivo = aluno.situacao?.ativo === true;

    const temNotasComp = typeof temNotasCompletas === 'function'
      ? temNotasCompletas(aluno, isSemestre)
      : false;

    const mediaFinalNum = (aluno.mediaFinal !== null && aluno.mediaFinal !== undefined && !isNaN(aluno.mediaFinal))
      ? Number(aluno.mediaFinal)
      : null;

    const campos = {
      nome: nomeNorm,
      nomeOriginal,
      matricula,
      numero,
      n: numero,
      num: numero,
      nro: numero,
      ativo: isAtivo,
      media: mediaFinalNum,
      med: mediaFinalNum,
      mediafinal: mediaFinalNum,
    };

    const periodosData = [];
    let temAlertaEr = false;
    let temAlgumaRec = false;
    let temAlgumaNotaPendente = !temNotasComp;

    periodos.forEach((p, idx) => {
      const numMatch = p.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0], 10) : (idx + 1);

      const regStr = typeof getNotaValorBruto === 'function' ? getNotaValorBruto(aluno.notas, p, false) : '--';
      const erStr = typeof getNotaValorBruto === 'function' ? getNotaValorBruto(aluno.notas, p, true) : '--';
      const finalStr = typeof getNotaTexto === 'function' ? getNotaTexto(aluno.notas, p) : '--';

      const regNum = (regStr !== '--' && regStr !== '') ? parseFloat(String(regStr).replace(',', '.')) : null;
      const erNum = (erStr !== '--' && erStr !== '') ? parseFloat(String(erStr).replace(',', '.')) : null;
      const finalNum = (finalStr !== '--' && finalStr !== '') ? parseFloat(String(finalStr).replace('*', '').replace(',', '.')) : null;

      if (erNum !== null) temAlgumaRec = true;
      if (erNum !== null && regNum === null) temAlertaEr = true;
      if (regNum === null) temAlgumaNotaPendente = true;

      periodosData.push({
        p,
        num,
        regNum,
        erNum,
        finalNum,
        isErSemTrimestre: (erNum !== null && regNum === null),
      });

      // Mapeamento de chaves
      campos[`t${num}`] = regNum;
      campos[`tri${num}`] = regNum;
      campos[`trim${num}`] = regNum;
      campos[`trimestre${num}`] = regNum;

      campos[`s${num}`] = regNum;
      campos[`sem${num}`] = regNum;
      campos[`semestre${num}`] = regNum;

      campos[`rec${num}`] = erNum;
      campos[`er${num}`] = erNum;
      campos[`recuperacao${num}`] = erNum;

      campos[`p${num}`] = finalNum;
      campos[`nota${num}`] = finalNum;
      campos[`periodo${num}`] = finalNum;
    });

    // Projeção de nota necessária no período de fechamento
    let notaMinObj = null;
    if (typeof calcularNotaMinimaPeriodo === 'function') {
      const periodoFechamento = isSemestre ? '2° Sem' : '3° Trim';
      notaMinObj = calcularNotaMinimaPeriodo(aluno, periodoFechamento);
    }

    campos.precisa = notaMinObj?.valorExato ?? null;
    campos.precisaStatus = notaMinObj?.status ?? null;
    campos.precisaAtingiu = notaMinObj?.atingiu ?? null;

    // Status geral do aluno
    let statusCat = 'semnota';
    if (temNotasComp && mediaFinalNum !== null) {
      if (mediaFinalNum >= 6) statusCat = 'aprov';
      else if (mediaFinalNum >= 5) statusCat = 'recup';
      else statusCat = 'reprov';
    } else if (mediaFinalNum !== null && mediaFinalNum > 0) {
      if (mediaFinalNum >= 6) statusCat = 'aprov';
      else if (mediaFinalNum >= 5) statusCat = 'recup';
      else statusCat = 'reprov';
    }

    campos.status = statusCat;
    campos.temAlertaEr = temAlertaEr;
    campos.temRec = temAlgumaRec;
    campos.semNota = temAlgumaNotaPendente;
    campos.periodosData = periodosData;

    return campos;
  }

  /**
   * Divide a consulta por "or" ou "ou" respeitando aspas.
   * @param {string} str
   * @returns {string[]}
   */
  function splitByOr(str) {
    const result = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        current += char;
      } else if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        current += char;
      } else if (!inDouble && !inSingle) {
        const rest = str.slice(i);
        const match = rest.match(/^(?:\s+(?:or|ou)\s+)/i);
        if (match) {
          result.push(current.trim());
          current = '';
          i += match[0].length - 1;
          continue;
        }
        current += char;
      } else {
        current += char;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result.length > 0 ? result : [str];
  }

  /**
   * Divide uma string em tokens individuais respeitando aspas e expressões regulares /.../.
   * @param {string} str
   * @returns {string[]}
   */
  function extractTokens(str) {
    const tokens = [];
    let current = '';
    let inDouble = false;
    let inSingle = false;
    let inRegex = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if (char === '"' && !inSingle && !inRegex) {
        inDouble = !inDouble;
        current += char;
      } else if (char === "'" && !inDouble && !inRegex) {
        inSingle = !inSingle;
        current += char;
      } else if (char === '/' && !inDouble && !inSingle) {
        if (!inRegex && (current.length === 0 || /\s$/.test(current))) {
          inRegex = true;
        } else if (inRegex) {
          inRegex = false;
        }
        current += char;
      } else if (/\s/.test(char) && !inDouble && !inSingle && !inRegex) {
        if (current.trim().length > 0) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim().length > 0) {
      tokens.push(current.trim());
    }

    return tokens;
  }

  /**
   * Mescla palavras-chave de negação ('not', 'nao', 'não') com o token seguinte.
   * @param {string[]} tokens
   * @returns {string[]}
   */
  function mergeNotTokens(tokens) {
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const lower = t.toLowerCase();
      if ((lower === 'not' || lower === 'nao' || lower === 'não') && i + 1 < tokens.length) {
        merged.push('!' + tokens[i + 1]);
        i++;
      } else {
        merged.push(t);
      }
    }
    return merged;
  }

  /**
   * Tokeniza a consulta completa em ramos OR de listas AND de tokens.
   * @param {string} rawQuery
   * @returns {string[][]}
   */
  function tokenizeQuery(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') return [];
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];

    const orBranches = splitByOr(trimmed);

    return orBranches.map(branch => {
      // Normaliza espaços em desigualdades duplas: "5 <= t1 <= 7" -> "5<=t1<=7"
      let s = branch.replace(/(\d+(?:[.,]\d+)?)\s*(<=|<|>=|>)\s*([a-zA-Z0-9_]+)\s*(<=|<|>=|>)\s*(\d+(?:[.,]\d+)?)/g, '$1$2$3$4$5');
      // Normaliza operadores binários: "t1 < 6" -> "t1<6", "rec1 > t1" -> "rec1>t1"
      s = s.replace(/([a-zA-Z0-9_]+)\s*(<=|>=|!=|<|>|=|:)\s*([^\s"']+)/g, '$1$2$3');

      const rawTokens = extractTokens(s);
      const filtered = rawTokens.filter(t => t.toLowerCase() !== 'e' && t.toLowerCase() !== 'and');
      return mergeNotTokens(filtered);
    });
  }

  /**
   * Compara dois números de acordo com o operador informado.
   * @param {number} a
   * @param {string} op
   * @param {number} b
   * @returns {boolean}
   */
  function compareNumeric(a, op, b) {
    switch (op) {
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '=':
      case ':': return Math.abs(a - b) < 0.001;
      case '!=': return Math.abs(a - b) >= 0.001;
      default: return false;
    }
  }

  /**
   * Envolve a função com lógica de negação quando aplicável.
   * @param {Function} fn
   * @param {boolean} negate
   * @returns {Function}
   */
  function wrapNegate(fn, negate) {
    if (!fn) return () => true;
    return negate ? (ctx) => !fn(ctx) : fn;
  }

  /**
   * Verifica se o identificador corresponde a um campo conhecido de notas/aluno.
   * @param {string} name
   * @returns {boolean}
   */
  function isFieldName(name) {
    return /^(?:t\d|tri\d|trim\d|trimestre\d|s\d|sem\d|semestre\d|rec\d|er\d|recuperacao\d|p\d|nota\d|periodo\d|media|med|precisa|num|numero|n|rec|trim|tri)$/i.test(name);
  }

  /**
   * Compila um token individual em um predicado (ctx) => boolean.
   * @param {string} token
   * @returns {Function}
   */
  function compileToken(token) {
    let negate = false;
    let raw = token.trim();

    if (raw.startsWith('!') || raw.startsWith('-')) {
      negate = true;
      raw = raw.slice(1).trim();
    } else if (/^(?:not|nao|não):/i.test(raw)) {
      negate = true;
      raw = raw.replace(/^(?:not|nao|não):/i, '').trim();
    }

    let fn = null;

    // 1. Desigualdade dupla encadeada: ex: 5 <= t1 <= 7 ou 7 >= t1 >= 5
    const chainedMatch = raw.match(/^(\d+(?:[.,]\d+)?)\s*(<=|<|>=|>)\s*([a-zA-Z0-9_]+)\s*(<=|<|>=|>)\s*(\d+(?:[.,]\d+)?)$/i);
    if (chainedMatch) {
      const num1 = parseFloat(chainedMatch[1].replace(',', '.'));
      const op1 = chainedMatch[2];
      const field = chainedMatch[3].toLowerCase();
      const op2 = chainedMatch[4];
      const num2 = parseFloat(chainedMatch[5].replace(',', '.'));

      fn = (ctx) => {
        const val = ctx[field];
        if (val === null || val === undefined || isNaN(val)) return false;
        const c1 = compareNumeric(num1, op1, val);
        const c2 = compareNumeric(val, op2, num2);
        return c1 && c2;
      };
      return wrapNegate(fn, negate);
    }

    // 2. Comparação binária ou prefixo com dois pontos: LHS OP RHS
    const binMatch = raw.match(/^([a-zA-Z0-9_]+)\s*(<=|>=|!=|<|>|=|:)\s*(.+)$/i);
    if (binMatch) {
      const lhs = binMatch[1].toLowerCase();
      const op = binMatch[2];
      const rhs = binMatch[3].trim();

      // 2.1 Faixa numérica: t1: 4..6 ou t1: 4-6
      const rangeMatch = rhs.match(/^(\d+(?:[.,]\d+)?)(?:\.\.|\-)(\d+(?:[.,]\d+)?)$/);
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1].replace(',', '.'));
        const max = parseFloat(rangeMatch[2].replace(',', '.'));
        fn = (ctx) => {
          const val = ctx[lhs];
          if (val === null || val === undefined || isNaN(val)) return false;
          return val >= min && val <= max;
        };
        return wrapNegate(fn, negate);
      }

      // 2.2 Status: status:aprov, status:recup, status:reprov, status:semnota, status:ativo, status:inativo
      if (lhs === 'status') {
        const valRhs = rhs.toLowerCase();
        fn = (ctx) => {
          if (valRhs.startsWith('aprov')) return ctx.status === 'aprov';
          if (valRhs.startsWith('recup')) return ctx.status === 'recup';
          if (valRhs.startsWith('reprov')) return ctx.status === 'reprov';
          if (valRhs.startsWith('sem') || valRhs.startsWith('pend')) return ctx.status === 'semnota';
          if (valRhs === 'ativo') return ctx.ativo === true;
          if (valRhs === 'inativo') return ctx.ativo === false;
          return ctx.status === valRhs;
        };
        return wrapNegate(fn, negate);
      }

      // 2.3 Alerta: alerta:er
      if (lhs === 'alerta') {
        fn = (ctx) => ctx.temAlertaEr === true;
        return wrapNegate(fn, negate);
      }

      // 2.4 Ativo: ativo:sim, ativo:nao, ativo:true, ativo:false
      if (lhs === 'ativo') {
        const valRhs = rhs.toLowerCase();
        const wantActive = ['sim', 'true', '1', 's'].includes(valRhs);
        fn = (ctx) => ctx.ativo === wantActive;
        return wrapNegate(fn, negate);
      }

      // 2.5 Vazio / sem nota: t1:vazio, t1=--, rec1=--
      const isVazioCheck = ['--', 'vazio', 'semnota', 'pendente', 'null', 'vazia'].includes(rhs.toLowerCase());
      if (isVazioCheck) {
        fn = (ctx) => {
          const val = ctx[lhs];
          const isNull = (val === null || val === undefined);
          return (op === '!=' ? !isNull : isNull);
        };
        return wrapNegate(fn, negate);
      }

      // 2.6 sem:rec1, tem:rec1, com:rec1 (ou rec1:tem, rec1:sem)
      if (lhs === 'sem' || lhs === 'com' || lhs === 'tem') {
        const target = rhs.toLowerCase();
        fn = (ctx) => {
          if (target === 'rec' || target === 'er') {
            return lhs === 'sem' ? !ctx.temRec : ctx.temRec;
          }
          const val = ctx[target];
          const hasVal = (val !== null && val !== undefined);
          return lhs === 'sem' ? !hasVal : hasVal;
        };
        return wrapNegate(fn, negate);
      }

      // 2.7 Projeção de aprovação: precisa:garantido, precisa:exame, precisa <= 4
      if (lhs === 'precisa' || lhs === 'meta' || lhs === 'falta') {
        const valRhs = rhs.toLowerCase();
        if (valRhs === 'garantido') {
          fn = (ctx) => ctx.precisaStatus === 'garantido';
          return wrapNegate(fn, negate);
        }
        if (valRhs === 'exame') {
          fn = (ctx) => ctx.precisaStatus === 'exame';
          return wrapNegate(fn, negate);
        }
        const targetNum = parseFloat(rhs.replace(',', '.'));
        if (!isNaN(targetNum)) {
          fn = (ctx) => {
            if (ctx.precisa === null || ctx.precisa === undefined) return false;
            return compareNumeric(ctx.precisa, op, targetNum);
          };
          return wrapNegate(fn, negate);
        }
      }

      // 2.8 Comparação de campo com outro campo: rec1 > t1, er2 >= t2, rec > trim
      const rhsField = rhs.toLowerCase();
      if (isFieldName(rhsField)) {
        fn = (ctx) => {
          if (lhs === 'rec' && (rhsField === 'trim' || rhsField === 'tri')) {
            return ctx.periodosData.some(p => p.erNum !== null && p.regNum !== null && compareNumeric(p.erNum, op, p.regNum));
          }
          const vLhs = ctx[lhs];
          const vRhs = ctx[rhsField];
          if (vLhs === null || vLhs === undefined || vRhs === null || vRhs === undefined) return false;
          return compareNumeric(vLhs, op, vRhs);
        };
        return wrapNegate(fn, negate);
      }

      // 2.9 Comparação genérica: rec < 6 ou trim < 6
      if (lhs === 'rec' || lhs === 'er') {
        const targetNum = parseFloat(rhs.replace(',', '.'));
        if (!isNaN(targetNum)) {
          fn = (ctx) => ctx.periodosData.some(p => p.erNum !== null && compareNumeric(p.erNum, op, targetNum));
          return wrapNegate(fn, negate);
        }
      }
      if (lhs === 'trim' || lhs === 'tri') {
        const targetNum = parseFloat(rhs.replace(',', '.'));
        if (!isNaN(targetNum)) {
          fn = (ctx) => ctx.periodosData.some(p => p.regNum !== null && compareNumeric(p.regNum, op, targetNum));
          return wrapNegate(fn, negate);
        }
      }

      // 2.10 Comparação de campo específico com número: t1 < 6, rec1 >= 7, media < 6, num <= 10
      const targetNum = parseFloat(rhs.replace(',', '.'));
      if (!isNaN(targetNum)) {
        fn = (ctx) => {
          const val = ctx[lhs];
          if (val === null || val === undefined || isNaN(val)) return false;
          return compareNumeric(val, op, targetNum);
        };
        return wrapNegate(fn, negate);
      }

      // 2.11 Busca explícita por nome ou matrícula: nome:joao, mat:123
      if (lhs === 'nome') {
        const normRhs = normalizeStr(rhs);
        fn = (ctx) => ctx.nome.includes(normRhs);
        return wrapNegate(fn, negate);
      }
      if (lhs === 'mat' || lhs === 'matricula') {
        fn = (ctx) => ctx.matricula.includes(rhs);
        return wrapNegate(fn, negate);
      }
    }

    // 3. Palavras-chave autônomas
    const lower = raw.toLowerCase();

    if (lower === 'aprov' || lower === 'aprovado' || lower === 'aprovados') {
      fn = (ctx) => ctx.status === 'aprov';
      return wrapNegate(fn, negate);
    }
    if (lower === 'recup' || lower === 'recuperacao' || lower === 'recuperação') {
      fn = (ctx) => ctx.status === 'recup';
      return wrapNegate(fn, negate);
    }
    if (lower === 'reprov' || lower === 'reprovado' || lower === 'reprovados') {
      fn = (ctx) => ctx.status === 'reprov';
      return wrapNegate(fn, negate);
    }
    if (lower === 'ativo' || lower === 'ativos') {
      fn = (ctx) => ctx.ativo === true;
      return wrapNegate(fn, negate);
    }
    if (lower === 'inativo' || lower === 'inativos') {
      fn = (ctx) => ctx.ativo === false;
      return wrapNegate(fn, negate);
    }
    if (lower === 'semnota' || lower === 'pendente' || lower === 'pendentes') {
      fn = (ctx) => ctx.semNota === true;
      return wrapNegate(fn, negate);
    }
    if (lower === 'garantido' || lower === 'garantidos') {
      fn = (ctx) => ctx.precisaStatus === 'garantido';
      return wrapNegate(fn, negate);
    }
    if (lower === 'exame' || lower === 'exames') {
      fn = (ctx) => ctx.precisaStatus === 'exame';
      return wrapNegate(fn, negate);
    }
    if (lower === 'alerta' || lower === 'alerta:er') {
      fn = (ctx) => ctx.temAlertaEr === true;
      return wrapNegate(fn, negate);
    }

    // 4. Expressão Regular pura: /^maria/i
    const regexMatch = raw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        const rx = new RegExp(regexMatch[1], regexMatch[2]);
        fn = (ctx) => rx.test(ctx.nomeOriginal) || rx.test(ctx.nome);
        return wrapNegate(fn, negate);
      } catch {
        // Expressão regular inválida: cai no fallback textual
      }
    }

    // 5. Fallback textual: busca em nome e matrícula
    let textTerm = raw.replace(/^["']|["']$/g, '');
    const normTerm = normalizeStr(textTerm);
    fn = (ctx) => {
      return ctx.nome.includes(normTerm) || ctx.matricula.includes(textTerm);
    };
    return wrapNegate(fn, negate);
  }

  /**
   * Compila uma string de consulta em uma estrutura executável de predicados.
   * @param {string} query
   * @returns {{ raw: string, branches: Function[][] }|null}
   */
  function compileAlunoFilter(query) {
    if (!query || typeof query !== 'string' || !query.trim()) return null;
    const orBranches = tokenizeQuery(query);
    if (orBranches.length === 0) return null;

    const compiledBranches = orBranches.map(branchTokens => {
      return branchTokens.map(compileToken);
    });

    return {
      raw: query,
      branches: compiledBranches,
    };
  }

  /**
   * Avalia se um aluno atende ao filtro previamente compilado.
   * @param {Object} aluno
   * @param {string[]} periodos
   * @param {boolean} isSemestre
   * @param {Object} compiledFilter
   * @returns {boolean}
   */
  function matchesCompiledFilter(aluno, periodos, isSemestre, compiledFilter) {
    if (!compiledFilter || !compiledFilter.branches || compiledFilter.branches.length === 0) return true;
    if (!aluno) return false;

    const ctx = extrairValoresAluno(aluno, periodos, isSemestre);
    if (!ctx) return false;

    for (const branch of compiledFilter.branches) {
      let branchMatch = true;
      for (const predicate of branch) {
        if (!predicate(ctx)) {
          branchMatch = false;
          break;
        }
      }
      if (branchMatch) return true;
    }

    return false;
  }

  /**
   * Função utilitária direta para checar se um aluno corresponde à query de texto.
   * @param {Object} aluno
   * @param {string} query
   * @param {string[]} periodos
   * @param {boolean} isSemestre
   * @returns {boolean}
   */
  function matchAlunoFiltro(aluno, query, periodos, isSemestre) {
    if (!query || !query.trim()) return true;
    const compiled = compileAlunoFilter(query);
    return matchesCompiledFilter(aluno, periodos, isSemestre, compiled);
  }

  // Exportação para escopo global (navegador e service worker) e Node.js
  const api = {
    normalizeStr,
    extrairValoresAluno,
    tokenizeQuery,
    compileToken,
    compileAlunoFilter,
    matchesCompiledFilter,
    matchAlunoFiltro,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    Object.assign(global, api);
  }
  if (typeof window !== 'undefined') {
    Object.assign(window, api);
  }
  if (typeof self !== 'undefined') {
    Object.assign(self, api);
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
