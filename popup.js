// --- FUNÇÕES DE CÁLCULO (Média Ponderada 3, 3, 4) ---
function getNotaValor(lista, periodo) {
  const item = lista.find(r => r.nomePeriodo === periodo);
  if (!item || item.resultado === "--" || item.resultado == null) return -1; // -1 indica sem nota
  return parseFloat(item.resultado);
}

function getNotaTexto(lista, periodo) {
  const item = lista.find(r => r.nomePeriodo === periodo);
  return (item && item.resultado !== null) ? item.resultado : "";
}

function calcularMediaFinal(listaResultados) {
  const resolverTrimestre = (reg, rec) => {
    let nReg = getNotaValor(listaResultados, reg);
    let nRec = getNotaValor(listaResultados, rec);
    let final = Math.max(nReg, nRec);
    return final < 0 ? 0 : final; // Se não tiver nota, assume 0 para o cálculo
  };

  const re1 = resolverTrimestre("1° Trim", "ER1ºTri");
  const re2 = resolverTrimestre("2° Trim", "ER2ºTri");
  const re3 = resolverTrimestre("3° Trim", "ER3ºTri");

  // Cálculo: (T1*3 + T2*3 + T3*4) / 10
  const media = ((re1 * 3) + (re2 * 3) + (re3 * 4)) / 10;
  return parseFloat(media.toFixed(1));
}

// --- API ---
async function fetchEscolaRS(endpoint, token) {
  const url = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { "Authorization": token, "Content-Type": "application/json" }
  });

  if (!response.ok) return null;
  return response.json();
}

// --- EXECUÇÃO ---
document.getElementById('btnExportar').addEventListener('click', async () => {
  const btn = document.getElementById('btnExportar');
  const statusDiv = document.getElementById('status');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  
  // --- Reset UI ---
  btn.disabled = true;
  statusDiv.style.color = "#000";
  statusDiv.innerText = "Iniciando...";
  progressContainer.style.display = "none";
  progressBar.style.width = "0%";

  try {
    // 1. Verificar Autenticação
    const data = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    if (!data.escolaRsToken || !data.nrDoc) throw new Error("Token não encontrado. Atualize a página do EscolaRS.");

    const cpfLimpo = String(data.nrDoc).replace(/\D/g, "");
    statusDiv.innerText = "Buscando turmas...";

    // 2. Buscar Dados do Professor
    const infoInicial = await fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${cpfLimpo}`, data.escolaRsToken);
    if (!infoInicial) throw new Error("Erro ao buscar dados do professor.");
    
    const idRecHumano = infoInicial.idRecHumano;
    const wb = XLSX.utils.book_new(); // Cria Workbook
    let dadosEncontrados = false;

    // --- Setup da Barra de Progresso ---
    const totalDisciplinas = infoInicial.escolas.reduce((total, esc) => 
      total + esc.turmas.reduce((subtotal, tur) => subtotal + tur.disciplinas.length, 0), 0);
    let disciplinasProcessadas = 0;

    if (totalDisciplinas > 0) {
      progressContainer.style.display = "block";
    }

    // 3. Iterar sobre Escolas > Turmas > Disciplinas
    for (let escola of infoInicial.escolas) {
      for (let turma of escola.turmas) {
        for (let disc of turma.disciplinas) {
          
          disciplinasProcessadas++;

          // Mostra qual turma/disciplina está processando
          const progresso = Math.round((disciplinasProcessadas / totalDisciplinas) * 100);
          progressBar.style.width = `${progresso}%`;
          statusDiv.innerText = `Processando: ${turma.nome} - ${disc.nome}`;
          
          // Endpoint com /false para trazer detalhes
          const endpoint = `listarAulasDaTurmaComResultado/${turma.id}/${disc.id}/${idRecHumano}/false`;
          const res = await fetchEscolaRS(endpoint, data.escolaRsToken);
          
          const alunos = (res && res.alunos) ? res.alunos : [];

          if (alunos.length > 0) {
            dadosEncontrados = true;
            
            // Montar linhas do Excel
            const linhasExcel = alunos.map(aluno => {
              const notas = aluno.listaResultados || [];
              
              return {
                "Matrícula": aluno.matricula,
                "Nome": aluno.nome,
                "Situação": (aluno.situacao && aluno.situacao.descricao) ? aluno.situacao.descricao : "-",
                
                // Colunas de Notas
                "1º Tri": getNotaTexto(notas, "1° Trim"),
                "Rec 1": getNotaTexto(notas, "ER1ºTri"),
                "2º Tri": getNotaTexto(notas, "2° Trim"),
                "Rec 2": getNotaTexto(notas, "ER2ºTri"),
                "3º Tri": getNotaTexto(notas, "3° Trim"),
                "Rec 3": getNotaTexto(notas, "ER3ºTri"),
                
                // Média Calculada
                "MÉDIA FINAL": calcularMediaFinal(notas)
              };
            });

            // Criar Aba (Sheet)
            const ws = XLSX.utils.json_to_sheet(linhasExcel);

            // Ajuste de largura de colunas
            ws['!cols'] = [
              {wch: 10}, {wch: 35}, {wch: 12}, 
              {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, 
              {wch: 12}
            ];

            // Nome da Aba (Limpo)
            let nomeAba = `${turma.nome}-${disc.nome}`.replace(/[:\\/?*\[\]]/g, "").substring(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, nomeAba);
          }
        }
      }
    }

    if (!dadosEncontrados) throw new Error("Nenhuma turma com alunos encontrada.");

    // 4. Download
    statusDiv.innerText = "Salvando arquivo...";
    progressBar.style.width = `100%`; // Garante 100% ao final

    const nomeArquivo = `Notas_${infoInicial.nome.replace(/\s+/g,'_')}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
    
    statusDiv.style.color = "green";
    statusDiv.innerText = "Concluído com sucesso!";

  } catch (error) {
    statusDiv.style.color = "red";
    statusDiv.innerText = "Erro: " + error.message;
    progressContainer.style.display = "none"; // Esconde em caso de erro
  } finally {
    btn.disabled = false;
  }
});