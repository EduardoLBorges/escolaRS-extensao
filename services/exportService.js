/**
 * Serviço de exportação de dados do dashboard.
 */

/**
 * Exporta os dados do dashboard para um arquivo XLSX.
 * @param {Object} dashboardData - Dados completos do dashboard.
 * @param {string} escolaSelecionada - Filtro de escola.
 * @param {string} turmaSelecionada - Filtro de turma.
 * @param {string} alunoFiltro - Filtro de nome de aluno.
 */
function exportarXLSX(dashboardData, escolaSelecionada, turmaSelecionada, alunoFiltro) {
  if (!dashboardData || !dashboardData.escolas) return;

  const wb = XLSX.utils.book_new();
  let temDados = false;

  for (const escola of dashboardData.escolas) {
    if (escolaSelecionada && escola.nome !== escolaSelecionada) continue;

    for (const turma of escola.turmas) {
      if (turmaSelecionada && turma.nome !== turmaSelecionada) continue;

      let todosOsAlunos = [];
      for (const disc of turma.disciplinas) {
        todosOsAlunos = todosOsAlunos.concat(disc.alunos || []);
      }
      if (todosOsAlunos.length === 0) continue;

      const { periodos, isSemestre } = detectarTipoEPeriodos(todosOsAlunos);
      const dados = [];

      const cabecalho = ['Matrícula', 'Nome'];
      for (const periodo of periodos) {
        cabecalho.push(periodo);
        if (!isSemestre) {
          const numMatch = periodo.match(/\d+/);
          if (numMatch) cabecalho.push(`ER${numMatch[0]}`);
        }
      }
      cabecalho.push('Disciplina', 'Média Final', 'Status');
      dados.push(cabecalho);

      let temAlunosTurma = false;

      for (const disc of turma.disciplinas) {
        const alunosFiltrados = getAlunosAtivos(disc.alunos || []).filter(a => a.nome.toLowerCase().includes(alunoFiltro));

        for (const aluno of alunosFiltrados) {
          temAlunosTurma = true;
          temDados = true;

          const linha = [aluno.matricula || '', aluno.nome];

          for (const periodo of periodos) {
            linha.push(getNotaValorBruto(aluno.notas, periodo, false));
            if (!isSemestre) {
              linha.push(getNotaValorBruto(aluno.notas, periodo, true));
            }
          }

          const { texto } = getAlunoStatus(aluno.mediaFinal, aluno.mediaFinal > 0);
          const status = texto || 'Sem Notas';

          linha.push(
            disc.disciplina || '',
            aluno.mediaFinal > 0 ? aluno.mediaFinal.toFixed(1).replace('.', ',') : '--',
            status
          );
          dados.push(linha);
        }
      }

      if (temAlunosTurma && dados.length > 1) {
        const nomeAba = turma.nome.substring(0, 31);
        const ws = XLSX.utils.aoa_to_sheet(dados);

        const colWidths = [{ wch: 12 }, { wch: 25 }];
        for (const _ of periodos) {
          colWidths.push({ wch: 10 });
          if (!isSemestre) colWidths.push({ wch: 8 });
        }
        colWidths.push({ wch: 20 }, { wch: 12 }, { wch: 15 });
        ws['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, nomeAba);
      }
    }
  }

  if (!temDados) {
    alert('Nenhum dado para exportar com os filtros selecionados.');
    return;
  }

  const nomeArquivo = `${dashboardData.professor.replace(/\s+/g, '_')}_notas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, nomeArquivo);
}
