/**
 * Retorna os alunos ativos de uma lista.
 * @param {Array} alunos 
 * @returns {Array}
 */
function getAlunosAtivos(alunos) {
  return (alunos || []).filter(aluno => aluno.situacao?.ativo === true);
}

/**
 * Retorna o nome do aluno formatado com sua situação (se inativo).
 * @param {Object} aluno 
 * @returns {string}
 */
function getNomeComSituacao(aluno) {
  if (aluno.situacao && aluno.situacao.ativo !== true && aluno.situacao.descricao) {
    return `${aluno.nome} <span class="aluno-inativo-descricao">(${aluno.situacao.descricao})</span>`;
  }
  return aluno.nome;
}
