/**
 * Avaliacoes Service - Orquestra a exportação, decodificação e importação de notas
 */
class AvaliacoesService {
    constructor() {
        this.cacheInfo = null; // { token, idRecHumano, dashboardData }
    }

    async init() {
        const authData = await chrome.storage.local.get(['escolaRsToken', 'nrDoc']);
        if (!authData.escolaRsToken || !authData.nrDoc) throw new Error('Credenciais ausentes. Abra o portal EscolaRS.');

        // Precisamos dos dados base de escolas e turmas
        const infoInicial = await listarEscolasProfessor(authData.nrDoc, authData.escolaRsToken);
        const { idRecHumano } = infoInicial;

        this.cacheInfo = {
            token: authData.escolaRsToken,
            nrDoc: authData.nrDoc,
            idRecHumano,
            escolas: infoInicial.escolas
        };

        return this.cacheInfo;
    }

    // --- Helpers de Manipulação de XLS --- //

    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async fetchComRetry(url, options = {}, retries = 2) {
        let lastErr;
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(url, options);
                if (res.ok) return res;
                if (res.status === 401 || res.status === 403) throw new Error('Falha de permissão / Token expirado');
                throw new Error(`Erro API: ${res.status}`);
            } catch (err) {
                lastErr = err;
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // backoff
            }
        }
        throw lastErr;
    }

    // --- Exportação --- //

    async carregarPeriodos() {
        if (!this.cacheInfo) await this.init();

        // Pega uma disciplina qualquer para extrair os períodos padrão da API
        let firstClass = null;
        for (const esc of this.cacheInfo.escolas) {
            for (const tur of esc.turmas) {
                if (tur.disciplinas && tur.disciplinas.length > 0) {
                    firstClass = { idTurma: tur.id, idDisc: tur.disciplinas[0].id };
                    break;
                }
            }
            if (firstClass) break;
        }

        if (!firstClass) return [];

        const url = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/listarAvaliacoesTurma/${firstClass.idTurma}/${firstClass.idDisc}/${this.cacheInfo.idRecHumano}`;
        const res = await fetch(url, { headers: { 'Authorization': this.cacheInfo.token } });
        if (!res.ok) return [];

        const avaliacoes = await res.json();
        const periodosMap = new Map();

        for (const item of avaliacoes) {
            if (item.id && item.descricao) {
                periodosMap.set(item.id, item.descricao);
            }
        }

        return Array.from(periodosMap.entries()).map(([id, descricao]) => ({ id, descricao }));
    }

    async exportarMassa(periodoId, onProgress) {
        if (!this.cacheInfo) await this.init();
        const { escolas, idRecHumano, token } = this.cacheInfo;

        const allTasks = [];
        for (const esc of escolas) {
            for (const tur of esc.turmas) {
                for (const disc of tur.disciplinas) {
                    allTasks.push({
                        escolaNome: esc.nome,
                        turmaId: tur.id,
                        turmaNome: tur.nome,
                        discId: disc.id,
                        discNome: disc.nome
                    });
                }
            }
        }

        let concluido = 0;
        const total = allTasks.length;
        onProgress({ status: 'Aguardando...', pct: 0 });

        const wbPorEscola = {}; // agrupa { Escola -> WorkBook }

        // Mapeamento em lotes concorrência limitada (limite = 3)
        const batchSize = 3;
        for (let i = 0; i < allTasks.length; i += batchSize) {
            const batchTasks = allTasks.slice(i, i + batchSize);

            await Promise.all(batchTasks.map(async (task) => {
                try {
                    // 1. Encontrar o idInstrumento via listarAvaliacoesTurma
                    const urlAval = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/listarAvaliacoesTurma/${task.turmaId}/${task.discId}/${idRecHumano}`;
                    const resAval = await this.fetchComRetry(urlAval, { headers: { 'Authorization': token } });
                    const arrayAvals = await resAval.json();

                    // Identificar os instrumentos filtrados pelo período
                    let instrumentos = [];
                    const periodoEncontrado = arrayAvals.find(a => parseInt(a.id) === parseInt(periodoId));
                    if (periodoEncontrado && periodoEncontrado.instrumentos) {
                        instrumentos = periodoEncontrado.instrumentos;
                    }

                    if (instrumentos.length === 0) return; // Nenhuma avaliação para puxar, pula classe

                    // 2. Extrair dados de alunos (para associar idAluno / matricula)
                    // Tenta reaproveitar a cache do dashboard
                    let alunosInfo = null;
                    const bkgData = await chrome.storage.local.get(['dashboardCache']);
                    if (bkgData.dashboardCache && bkgData.dashboardCache.data && bkgData.dashboardCache.data.escolas) {
                        const dC = bkgData.dashboardCache.data.escolas;
                        for (const esc of dC) {
                            if (esc.id === task.escolaId) {
                                for (const t of esc.turmas) {
                                    if (t.id === task.turmaId) {
                                        for (const d of t.disciplinas) {
                                            if (d.id === task.discId) {
                                                alunosInfo = d.alunos;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Se não encontrou no cache, faz fetch
                    if (!alunosInfo || alunosInfo.length === 0) {
                        const urlAlunos = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/listarAulasDaTurmaComResultado/${task.turmaId}/${task.discId}/${idRecHumano}/false`;
                        const resAlunos = await this.fetchComRetry(urlAlunos, { headers: { 'Authorization': token } });
                        const dataAlunos = await resAlunos.json();
                        alunosInfo = dataAlunos.alunos || [];
                    }

                    const alunosMap = new Map();
                    if (alunosInfo) {
                        alunosInfo.forEach(a => {
                            // chave simplificada
                            const nomeNormalize = (a.nome || '').replace(/\s+/g, '').toLowerCase();
                            // No cache o número de matrícula é retornado em 'matricula', igual à chamada.
                            alunosMap.set(nomeNormalize, a);
                        });
                    }

                    // 3. Pegar o XLS original gerado para ter a base e layout correto
                    const urlCsv = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/gerarXls/${task.turmaId}/${task.discId}/${idRecHumano}/${periodoId}`;
                    const resCsv = await this.fetchComRetry(urlCsv, { headers: { 'Authorization': token } });
                    const jsonCsv = await resCsv.json();

                    if (!jsonCsv || !jsonCsv.xls) return;

                    const arrayBuffer = this.base64ToArrayBuffer(jsonCsv.xls);
                    const wbOrig = XLSX.read(arrayBuffer, { type: 'array' });
                    const sheetOrig = wbOrig.Sheets[wbOrig.SheetNames[0]];

                    // Converte pra JSON para facilitar manipulação
                    const jsonData = XLSX.utils.sheet_to_json(sheetOrig, { header: 1 });

                    // -- Modifica e injeta o ID no JSON -- //

                    // Procurar linha de CABEÇALHO (onde tem a string dos instrumentos)
                    let headerRowIndex = -1;
                    for (let rowIdx = 0; rowIdx < Math.min(5, jsonData.length); rowIdx++) {
                        const row = jsonData[rowIdx];
                        if (!row) continue;
                        if (row.some(c => typeof c === 'string' && (c === 'Aluno' || c.includes('Aluno')))) {
                            headerRowIndex = rowIdx;
                            break;
                        }
                    }

                    let newJsonData = jsonData;

                    if (headerRowIndex !== -1) {
                        const headerRow = jsonData[headerRowIndex];
                        const oldAlunoColIdx = headerRow.findIndex(c => typeof c === 'string' && c.includes('Aluno'));

                        // Mapeia IDs para colunas
                        for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
                            const colName = headerRow[colIdx];
                            if (!colName || typeof colName !== 'string') continue;

                            const instrMatch = instrumentos.find(ins => colName.toLowerCase().includes(ins.nome.toLowerCase()));
                            if (instrMatch) {
                                headerRow[colIdx] = `${colName} [INST:${instrMatch.id}]`;
                            }
                        }

                        // Insere "Matrícula" como primeira coluna do cabeçalho
                        headerRow.unshift('Matrícula');
                        const shiftedAlunoColIdx = oldAlunoColIdx !== -1 ? oldAlunoColIdx + 1 : -1;

                        // Adiciona tag de referência oculta no título ou primeira célula para permitir o "diff" depois
                        if (headerRowIndex > 0 && jsonData[0] && jsonData[0][0]) {
                            jsonData[0][0] = `${jsonData[0][0]} [REF:${task.turmaId}-${task.discId}]`;
                        }

                        newJsonData = [];

                        for (let r = 0; r < jsonData.length; r++) {
                            const row = jsonData[r] || [];

                            if (r < headerRowIndex) {
                                if (row.length > 0) row.unshift(''); // Mantém formatação anterior
                                newJsonData.push(row);
                            } else if (r === headerRowIndex) {
                                // O cabeçalho já sofreu unshift
                                newJsonData.push(row);
                            } else {
                                if (row.length > 0) row.unshift(''); // Adiciona espaço vazio para a matrícula inicialmente

                                if (shiftedAlunoColIdx === -1) {
                                    newJsonData.push(row);
                                    continue;
                                }

                                const nomeBruto = row[shiftedAlunoColIdx] || '';
                                if (!nomeBruto) {
                                    newJsonData.push(row);
                                    continue; // Linhas em branco estilísticas da Procergs
                                }

                                const nomeLimpo = nomeBruto.replace(/^\d+\.\s*/, '').trim();
                                const nomeNorm = nomeLimpo.replace(/\s+/g, '').toLowerCase();

                                const alunoObj = alunosMap.get(nomeNorm);
                                if (alunoObj) {
                                    // Apenas considera quem está ativo
                                    const isAtivo = alunoObj.situacao ? alunoObj.situacao.ativo : true;

                                    if (isAtivo) {
                                        row[shiftedAlunoColIdx] = nomeBruto; // Nome limpo, sem o [ID:...]
                                        row[0] = alunoObj.matricula; // Matrícula na primeira coluna
                                        newJsonData.push(row);
                                    }
                                    // se não estiver ativo, a row não sofre o push => removida da tabela!
                                } else {
                                    newJsonData.push(row);
                                }
                            }
                        }
                    }

                    // Gera nova sheet a partir do newJsonData filtrado e encabeçado
                    const newWs = XLSX.utils.aoa_to_sheet(newJsonData);

                    // Cria ou atualiza workbook por escola
                    if (!wbPorEscola[task.escolaNome]) {
                        wbPorEscola[task.escolaNome] = XLSX.utils.book_new();
                    }

                    // Tratar nome da aba: Deve ser único (Turma + Disciplina truncada)
                    let sheetName = `${task.turmaNome}_${task.discNome}`.replace(/[\\/?*\[\]]/g, '').substring(0, 31);
                    let idxS = 1;
                    while (wbPorEscola[task.escolaNome].SheetNames.includes(sheetName)) {
                        sheetName = `${task.turmaNome}_${idxS}`.substring(0, 31);
                        idxS++;
                    }

                    XLSX.utils.book_append_sheet(wbPorEscola[task.escolaNome], newWs, sheetName);

                } catch (e) {
                    console.error(`Erro ao gerar base para ${task.turmaNome} / ${task.discNome}:`, e);
                } finally {
                    concluido++;
                    onProgress({
                        status: `Exportando [${concluido}/${total}]`,
                        pct: Math.round((concluido / total) * 100)
                    });
                }
            }));
        }

        // 4. Efetuar os Downloads em massa (com 1 seg. de intervalo)
        const escolaNames = Object.keys(wbPorEscola);
        if (escolaNames.length === 0) {
            throw new Error('Nenhuma planilha contendo alunos para este período foi encontrada.');
        }

        for (const [idx, eNome] of escolaNames.entries()) {
            const wb = wbPorEscola[eNome];
            if (wb.SheetNames.length === 0) continue;

            const safeName = eNome.replace(/\s+/g, '_').substring(0, 30);
            const dataStr = new Date().toISOString().split('T')[0];
            const resultFileName = `[${safeName}]_Avaliacoes_${dataStr}.xlsx`;

            setTimeout(() => {
                XLSX.writeFile(wb, resultFileName);
            }, idx * 600);
        }

        return escolaNames.length;
    }

    // --- Importação --- //

    async parseUploadedFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const listForPost = [];
                    const todayStr = new Date().toISOString().split('T')[0];

                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                        if (jsonData.length === 0) continue;

                        let headerRowIndex = -1;
                        for (let rowIdx = 0; rowIdx < Math.min(5, jsonData.length); rowIdx++) {
                            const row = jsonData[rowIdx];
                            if (row && row.some(c => typeof c === 'string' && c.includes('[INST:'))) {
                                headerRowIndex = rowIdx;
                                break;
                            }
                        }

                        if (headerRowIndex === -1) {
                            console.warn(`Aba "${sheetName}" ignorada por não possuir marcadores de [INST:...] no cabeçalho.`);
                            continue;
                        }

                        const headerRow = jsonData[headerRowIndex];
                        const instrCols = []; // array of { index, idInstrumento }

                        // 1. Mapeia Colunas Validando INST
                        for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
                            const colName = headerRow[colIdx];
                            if (!colName || typeof colName !== 'string') continue;
                            const matchIns = colName.match(/\[INST:(\d+)\]/);
                            if (matchIns) {
                                instrCols.push({
                                    idx: colIdx,
                                    idInstrumento: parseInt(matchIns[1], 10),
                                    nome: colName
                                });
                            }
                        }

                        // 2. Extrai Notas dos Alunos
                        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
                            const row = jsonData[r];
                            if (!row || row.length === 0) continue;

                            // Tenta obter o ID da primeira coluna (Matrícula) ou procura pelo marcador [ID:] em qualquer coluna
                            let idAluno = null;

                            // 1. Checa primeira coluna (Matrícula) - prioridade
                            const firstColVal = String(row[0] || '').trim();
                            if (/^\d+$/.test(firstColVal)) {
                                idAluno = parseInt(firstColVal, 10);
                            } else {
                                // 2. Fallback: procura [ID:xxx] em qualquer lugar da linha
                                const matchAlunoStr = row.find(c => typeof c === 'string' && c.includes('[ID:'));
                                if (matchAlunoStr) {
                                    const mId = matchAlunoStr.match(/\[ID:(\d+)\]/);
                                    if (mId) idAluno = parseInt(mId[1], 10);
                                }
                            }

                            if (!idAluno) continue;

                            // Itera sobre colunas com instrumentos identificados
                            for (const insMap of instrCols) {
                                const rawValue = row[insMap.idx];
                                if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                                    const cleanedValue = String(rawValue).replace(',', '.');
                                    const notaFinal = parseFloat(cleanedValue);

                                    if (!isNaN(notaFinal)) {
                                        listForPost.push({
                                            sheet: sheetName,
                                            payload: {
                                                idInstrumento: insMap.idInstrumento,
                                                idAluno: idAluno,
                                                dsAproveitamento: notaFinal,
                                                dataRealizacao: todayStr
                                            }
                                        });
                                    }
                                }
                            }
                        }
                    }
                    resolve(listForPost);
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    async enviarNotas(listaPayloads, onProgress, onLog) {
        if (!this.cacheInfo) await this.init();
        const { token } = this.cacheInfo;

        onLog(`Iniciando análise de alterações (DIFF automático)...`, 'info');

        // 1. Agrupar por instrumento para reduzir requisições de conferência
        const perInstrument = {};
        for (const item of listaPayloads) {
            const id = item.payload.idInstrumento;
            if (!perInstrument[id]) perInstrument[id] = [];
            perInstrument[id].push(item);
        }

        const finalQueue = [];
        const instrumentosIds = Object.keys(perInstrument);

        for (const idInstr of instrumentosIds) {
            // Como o endpoint /listarResultadosInstrumento não existe (retorna 404),
            // a extensão não tem como varrer o valor atual no servidor para fazer diff sem onerar a API pesadamente.
            // Portanto, apenas preparamos toda a fila válida informada na planilha para lote.
            finalQueue.push(...perInstrument[idInstr].map(f => f.payload));
        }

        if (finalQueue.length === 0) {
            onLog("\n[CHECK] Tudo em dia! Nenhuma nova alteração detectada em relação ao portal.", "success");
            onProgress({ pct: 100 });
            return 0;
        }

        let sent = 0;
        let successCount = 0;
        const total = finalQueue.length;
        const PAYLOAD_BATCH = 20;

        for (let i = 0; i < finalQueue.length; i += PAYLOAD_BATCH) {
            const batch = finalQueue.slice(i, i + PAYLOAD_BATCH);
            try {
                onLog(`Enviando lote de ${batch.length} notas...`, 'info');
                await registrarResultadoInstrumentoLista(batch, token);
                sent += batch.length;
                successCount += batch.length;
            } catch (err) {
                onLog(`[ERROR] Falha em um lote de envio: ${err.message}`, 'error');
            } finally {
                onProgress({ pct: Math.round((sent / total) * 100) });
            }
        }

        onLog(`\n[FINALIZADO] ${successCount} notas atualizadas com sucesso no EscolaRS!`, 'success');
        return successCount;
    }

    // --- Lançamento Direto (DataGrid Native) --- //
    
    async carregarDadosTabelaDireta(turmaId, discId, isSemestre, periodoId, idRecHumano) {
        if (!this.cacheInfo) await this.init();
        const { token } = this.cacheInfo;

        // 1. Encontrar o idInstrumento via listarAvaliacoesTurma
        const urlAval = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/listarAvaliacoesTurma/${turmaId}/${discId}/${idRecHumano}`;
        const resAval = await this.fetchComRetry(urlAval, { headers: { 'Authorization': token } });
        const arrayAvals = await resAval.json();

        let intrumentosPermitidos = new Set();
        const nomePeriodoProc = `° ${isSemestre ? 'Sem' : 'Trim'}`;
        let periodoEncontrado = null;

        for (const av of arrayAvals) {
            if (av.descricao && av.descricao.includes(nomePeriodoProc)) {
                if (!periodoId || av.id == periodoId) {
                    periodoEncontrado = av;
                    break;
                }
            }
        }

        let instrumentosApi = [];
        if (periodoEncontrado && periodoEncontrado.instrumentos) {
            instrumentosApi = periodoEncontrado.instrumentos;
            instrumentosApi.forEach(i => intrumentosPermitidos.add(i.id));
        }

        if (instrumentosApi.length === 0) {
            throw new Error("Nenhum instrumento de avaliação encontrado para esta disciplina no período selecionado.");
        }

        // Tenta reaproveitar a cache do dashboard
        let alunosInfo = null;
        let escolaCacheId = null;
        const bkgData = await chrome.storage.local.get(['dashboardCache']);
        if (bkgData.dashboardCache && bkgData.dashboardCache.data && bkgData.dashboardCache.data.escolas) {
            const dC = bkgData.dashboardCache.data.escolas;
            for (const esc of dC) {
                for (const t of esc.turmas) {
                    if (String(t.id) === String(turmaId)) {
                        for (const d of t.disciplinas) {
                            if (String(d.id) === String(discId)) {
                                alunosInfo = d.alunos;
                                escolaCacheId = esc.id;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Se não encontrou no cache, faz fetch
        if (!alunosInfo || alunosInfo.length === 0) {
            const urlAlunos = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/listarAulasDaTurmaComResultado/${turmaId}/${discId}/${idRecHumano}/false`;
            const resAlunos = await this.fetchComRetry(urlAlunos, { headers: { 'Authorization': token } });
            const dataAlunos = await resAlunos.json();
            alunosInfo = dataAlunos.alunos || [];
        }

        const alunosMap = new Map();
        if (alunosInfo) {
            alunosInfo.forEach(a => {
                let situacaoObj = null;
                if (a.situacaoAlunoTurma) {
                    situacaoObj = { ativo: a.situacaoAlunoTurma.ativo === "S" || a.situacaoAlunoTurma.ativo === true };
                } else {
                    situacaoObj = a.situacao || { ativo: true };
                }
                
                const nmLimpo = String(a.nome || '').replace(/^\d+\.\s*/, '').replace(/\s+/g, '').toLowerCase();
                alunosMap.set(nmLimpo, {
                    situacao: situacaoObj,
                    matricula: a.matricula || a.id,
                    nomeExibicao: String(a.nome || '').replace(/^\d+\.\s*/, '').trim()
                });
            });
        }

        // 3. Pegar o XLS original para obter as notas atuais formatadas corretamente pela SEDUC
        const urlCsv = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/gerarXls/${turmaId}/${discId}/${idRecHumano}/${periodoId}`;
        const resCsv = await this.fetchComRetry(urlCsv, { headers: { 'Authorization': token } });
        const jsonCsv = await resCsv.json();

        if (!jsonCsv || !jsonCsv.xls) {
            throw new Error("Falha ao obter os dados oficiais da turma.");
        }

        const arrayBuffer = this.base64ToArrayBuffer(jsonCsv.xls);
        const wbOrig = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetOrig = wbOrig.Sheets[wbOrig.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheetOrig, { header: 1 });

        let headerRowIndex = -1;
        for (let rowIdx = 0; rowIdx < Math.min(5, jsonData.length); rowIdx++) {
            const row = jsonData[rowIdx];
            // Utilizamos 'Aluno' como identificador infalível da linha de cabeçalho (idêntico à Exportação)
            if (row && row.some(c => typeof c === 'string' && c.includes('Aluno'))) {
                headerRowIndex = rowIdx;
                break;
            }
        }

        if (headerRowIndex === -1) {
            throw new Error("Formato de cabeçalho não reconhecido na resposta oficial.");
        }

        const headerRow = jsonData[headerRowIndex];
        const oldAlunoColIdx = headerRow.findIndex(c => typeof c === 'string' && c.includes('Aluno'));
        
        let cabecalhosIdentificados = [];
        for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
            const colName = headerRow[colIdx];
            if (!colName || typeof colName !== 'string') continue;
            
            for (const instr of instrumentosApi) {
                // A Procergs gera nomes longos cortados, usaremos startswith ou subset
                const safeApiName = instr.nome.substring(0, 5).toLowerCase();
                const safeColName = colName.substring(0, 5).toLowerCase();

                if (safeColName.includes(safeApiName) || colName.toLowerCase().includes(instr.nome.toLowerCase())) {
                    if (cabecalhosIdentificados.find(c => c.id === instr.id)) continue; 
                    cabecalhosIdentificados.push({
                        idx: colIdx,
                        id: instr.id,
                        nome: instr.nome,
                        peso: instr.peso,
                        ref: colName
                    });
                    break;
                }
            }
        }

        // Construir Array Limpo de Alunos com Notas
        const extractRecords = [];
        for (let r = headerRowIndex + 1; r < jsonData.length; r++) {
            const row = jsonData[r] || [];
            if (oldAlunoColIdx !== -1 && row[oldAlunoColIdx]) {
                const nomeBruto = row[oldAlunoColIdx];
                const nomeLimpo = String(nomeBruto).replace(/^\d+\.\s*/, '').trim();
                const nomeNorm = nomeLimpo.replace(/\s+/g, '').toLowerCase();

                const alunoObj = alunosMap.get(nomeNorm);
                
                // Exibe inativos também, mas marca (opcional, vamos filtrar ativos por padrão)
                const isAtivo = alunoObj && alunoObj.situacao ? alunoObj.situacao.ativo : true;
                
                if (isAtivo && alunoObj) {
                    const notasMap = {};
                    for (const cab of cabecalhosIdentificados) {
                        const rawVal = row[cab.idx];
                        let valFormatado = "";
                        if (rawVal !== undefined && rawVal !== null && rawVal !== '' && rawVal !== '--') {
                            const cleanedValue = parseFloat(String(rawVal).replace(',', '.'));
                            if (!isNaN(cleanedValue)) valFormatado = cleanedValue;
                        }
                        notasMap[cab.id] = valFormatado;
                    }

                    extractRecords.push({
                        matricula: alunoObj.matricula,
                        nome: alunoObj.nomeExibicao,
                        notas: notasMap
                    });
                }
            }
        }

        return {
            instrumentos: cabecalhosIdentificados,
            alunos: extractRecords
        };
    }
}
