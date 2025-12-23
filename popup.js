// --- FUNÇÃO AUXILIAR: EXTRAIR NOTA ---
function getNota(lista, periodo) {
  const item = lista.find(r => r.nomePeriodo === periodo);
  if (!item || item.resultado === "--" || item.resultado == null) return "";
  return parseFloat(item.resultado);
}

// --- FUNÇÃO AUXILIAR: CALCULAR MÉDIA ---
function calcularMediaFinal(listaResultados) {
  const getValor = (p) => {
    let v = getNota(listaResultados, p);
    return v === "" ? -1 : v;
  };

  const resolver = (reg, rec) => {
    let nReg = getValor(reg);
    let nRec = getValor(rec);
    let final = Math.max(nReg, nRec);
    return final < 0 ? 0 : final;
  };

  const re1 = resolver("1° Trim", "ER1ºTri");
  const re2 = resolver("2° Trim", "ER2ºTri");
  const re3 = resolver("3° Trim", "ER3ºTri");

  const media = ((re1 * 3) + (re2 * 3) + (re3 * 4)) / 10;
  return parseFloat(media.toFixed(1));
}

// --- FUNÇÃO DE REQUEST ---
async function fetchEscolaRS(endpoint, token) {
  const url = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/${endpoint}`;
  
  const statusDiv = document.getElementById('status');
  statusDiv.innerText = `Lendo: .../${endpoint.split('/').slice(-3).join('/')}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 
      "Authorization": token, 
      "Content-Type": "application/json" 
    }
  });

  if (!response.ok) {
    console.warn(`Erro ${response.status}: ${url}`);
    return null;
  }
  return response.json();
}

// --- LÓGICA PRINCIPAL ---
document.getElementById('btnExportar').addEventListener('click', async () => {
  const btn = document.getElementById('btnExportar');
  const statusDiv = document.getElementById('status');
  
  btn.disabled = true;
  statusDiv.style.color = "blue";
  statusDiv.innerText = "Iniciando...";

  try {
    const data = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    if (!data.escolaRsToken || !data.nrDoc) throw new Error("Dê F5 no EscolaRS para atualizar o token.");

    const cpfLimpo = String(data.nrDoc).replace(/\D/g, "");
    
    // 1. Busca Escolas
    const infoInicial = await fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${cpfLimpo}`, data.escolaRsToken);
    if (!infoInicial) throw new Error("Falha ao buscar professor.");
    const idRecHumano = infoInicial.idRecHumano;

    // --- CRIAÇÃO DO ARQUIVO EXCEL ---
    // Cria um novo livro de trabalho (Workbook)
    const wb = XLSX.utils.book_new();
    let temDados = false;

    // 2. Loops
    for (let escola of infoInicial.escolas) {
      for (let turma of escola.turmas) {
        for (let disc of turma.disciplinas) {
          
          const endpoint = `listarAulasDaTurmaComResultado/${turma.id}/${disc.id}/${idRecHumano}/false`;
          const res = await fetchEscolaRS(endpoint, data.escolaRsToken);
          const alunos = (res && res.alunos) ? res.alunos : [];

          if (alunos.length > 0) {
            temDados = true;
            
            // Prepara as linhas desta aba
            const linhasExcel = alunos.map(aluno => {
              const notas = aluno.listaResultados || [];
              const media = calcularMediaFinal(notas);

              // Estrutura da Linha do Excel
              return {
                "Matrícula": aluno.matricula,
                "Nome do Aluno": aluno.nome,
                "Situação": (aluno.situacao && aluno.situacao.descricao) ? aluno.situacao.descricao : "-",
                "1º Tri": getNota(notas, "1° Trim"),
                "Rec 1": getNota(notas, "ER1ºTri"),
                "2º Tri": getNota(notas, "2° Trim"),
                "Rec 2": getNota(notas, "ER2ºTri"),
                "3º Tri": getNota(notas, "3° Trim"),
                "Rec 3": getNota(notas, "ER3ºTri"),
                "MÉDIA FINAL": media
              };
            });

            // Cria a aba (Sheet)
            const ws = XLSX.utils.json_to_sheet(linhasExcel);

            // Define largura das colunas (Opcional, mas fica bonito)
            const wscols = [
              {wch: 10}, // Matrícula
              {wch: 40}, // Nome
              {wch: 15}, // Situação
              {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, {wch: 6}, // Notas
              {wch: 12}  // Média
            ];
            ws['!cols'] = wscols;

            // Nome da aba (Limitado a 31 caracteres pelo Excel)
            let nomeAba = `${turma.nome} - ${disc.nome}`.replace(/[\\/?*\[\]]/g, ""); // Remove chars proibidos
            if (nomeAba.length > 31) nomeAba = nomeAba.substring(0, 31);

            // Adiciona aba ao livro
            XLSX.utils.book_append_sheet(wb, ws, nomeAba);
          }
        }
      }
    }

    if (!temDados) throw new Error("Nenhuma turma com alunos encontrada.");

    // 3. Download do Arquivo .xlsx
    statusDiv.innerText = "Salvando arquivo...";
    const nomeArquivo = `Notas_${infoInicial.nome.replace(/ /g,'_')}.xlsx`;
    
    // A função writeFile da biblioteca faz o download automaticamente
    XLSX.writeFile(wb, nomeArquivo);
    
    statusDiv.style.color = "green";
    statusDiv.innerText = "Sucesso!";

  } catch (error) {
    console.error(error);
    statusDiv.style.color = "red";
    statusDiv.innerText = "Erro: " + error.message; 
  } finally {
    btn.disabled = false;
  }
});