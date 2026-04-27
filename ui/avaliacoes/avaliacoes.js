/**
 * avaliacoes.js - Controlador da UI de Avaliações em Massa
 */

const service = new AvaliacoesService();

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) window.lucide.createIcons();

    const loadingState = document.getElementById('loading');
    const tabsContainer = document.getElementById('tabsContainer');
    const loteView = document.getElementById('loteView');
    const diretoView = document.getElementById('diretoView');
    const selectPeriodo = document.getElementById('selectPeriodo');
    const selPeriodoDiretor = document.getElementById('selPeriodoDiretor');

    // UI Lançamento Direto
    const selEscola = document.getElementById('selEscola');
    const selTurma = document.getElementById('selTurma');
    const selDisc = document.getElementById('selDisc');
    const btnCarregarTabela = document.getElementById('btnCarregarTabela');
    const gridContainer = document.getElementById('gridContainer');
    const tbNotasHeadRow = document.getElementById('tbNotasHeadRow');
    const tbNotasBody = document.getElementById('tbNotasBody');
    const footerAcoes = document.getElementById('footerAcoes');
    const txtModificacoes = document.getElementById('txtModificacoes');
    const btnSalvarDireto = document.getElementById('btnSalvarDireto');

    let cacheDashboard = null;
    let periodosGlobais = [];
    let statePayloadsAguardos = {}; // idAluno-idInstr -> { aproveitamento, old }
    
    // Actions Export
    const btnExport = document.getElementById('btnExport');
    
    // Actions Import
    const btnImport = document.getElementById('btnImport');
    const fileUpload = document.getElementById('fileUpload');
    const importStatus = document.getElementById('importStatus');
    
    // Modal & Progress
    const importModal = document.getElementById('importModal');
    const importLog = document.getElementById('importLog');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnConfirmarUpload = document.getElementById('btnConfirmarUpload');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');

    let preparedPayloads = [];

    // --- Inicia a Visualização --- //
    try {
        await service.init();
        
        // Puxar os períodos
        periodosGlobais = await service.carregarPeriodos();
        selectPeriodo.innerHTML = '<option value="">Selecione...</option>';
        selPeriodoDiretor.innerHTML = '<option value="">Selecione...</option>';

        if (periodosGlobais.length > 0) {
            periodosGlobais.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.descricao;
                selectPeriodo.appendChild(opt);
                selPeriodoDiretor.appendChild(opt.cloneNode(true));
            });
            selectPeriodo.selectedIndex = 1;
            selPeriodoDiretor.selectedIndex = 1;
        } else {
            selectPeriodo.innerHTML = '<option value="">(Nenhum período validado)</option>';
            selPeriodoDiretor.innerHTML = selectPeriodo.innerHTML;
        }

        // Carregar dados de Escolas do cache do dashboard para os combos diretos
        const stData = await chrome.storage.local.get(['dashboardCache']);
        if (stData.dashboardCache && stData.dashboardCache.data) {
            cacheDashboard = stData.dashboardCache.data.escolas;
            cacheDashboard.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.nome;
                opt.textContent = e.nome;
                selEscola.appendChild(opt);
            });
        } else {
            showToast('Nenhum dado de turmas no cache. Abra o Dashboard primeiro.', 'warning');
        }

        loadingState.classList.add('hidden');
        tabsContainer.classList.remove('hidden');
        // layout já não é usado assim
    } catch (err) {
        showToast(`Erro na inicialização: ${err.message}`, 'error');
        loadingState.innerHTML = `<p style="color:var(--error);">Falha: ${err.message}</p>`;
    }

    // --- Navegação e Abas --- //
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-view').forEach(v => {
                v.classList.remove('active-view');
                v.classList.add('hidden');
            });
            
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            const targetView = document.getElementById(targetId);
            targetView.classList.add('active-view');
            targetView.classList.remove('hidden');
        });
    });

    btnVoltar.addEventListener('click', () => {
        window.location.href = '../chamada/chamada.html';
    });

    // --- Exportação --- //
    btnExport.addEventListener('click', async () => {
        const pId = selectPeriodo.value;
        if (!pId) {
            showToast('Selecione primeiro qual o período.', 'warning');
            return;
        }
        
        btnExport.disabled = true;
        const originalText = btnExport.innerHTML;
        
        try {
            await service.exportarMassa(pId, (prog) => {
                btnExport.innerHTML = `<i data-lucide="loader" class="spinner-small"></i> ${prog.status} - ${prog.pct}%`;
            });
            showToast('Arquivos baixados com sucesso! Revise sua pasta de downloads.', 'success');
        } catch (err) {
            showToast(`Erro na exportação: ${err.message}`, 'error');
        } finally {
            btnExport.disabled = false;
            btnExport.innerHTML = originalText;
        }
    });

    // --- Fluxo de Importação --- //
    btnImport.addEventListener('click', () => {
        fileUpload.click();
    });

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset state
        importStatus.textContent = `Arquivo carregado: ${file.name}`;
        importStatus.style.color = 'var(--text-muted)';
        importLog.innerHTML = `<div class="info">Lendo arquivo e formatando payloads...</div>`;
        btnConfirmarUpload.classList.add('hidden');
        uploadProgressContainer.classList.add('hidden');
        importModal.classList.remove('hidden');
        preparedPayloads = [];

        try {
            preparedPayloads = await service.parseUploadedFile(file);
            if (preparedPayloads.length === 0) {
                logMessage('Nenhuma nota detectada contendo IDs. Lembre-se preencher a versão EXPORTADA por este utilitário.', 'error');
                return;
            }

            logMessage(`Foram detectadas ${preparedPayloads.length} avaliações para atualizar em lote.`, 'success');
            btnConfirmarUpload.classList.remove('hidden');

        } catch (err) {
            logMessage(`Falha na leitura do Excel: ${err.message}`, 'error');
        } finally {
            fileUpload.value = ''; // clean up
        }
    });

    // Confirmação e Envio em Lote
    btnConfirmarUpload.addEventListener('click', async () => {
        btnConfirmarUpload.disabled = true;
        btnCloseModal.disabled = true;
        uploadProgressContainer.classList.remove('hidden');
        uploadProgressBar.style.width = '0%';

        try {
            const sucessos = await service.enviarNotas(preparedPayloads, 
            (prog) => {
                uploadProgressBar.style.width = `${prog.pct}%`;
            }, 
            (msg, tipo) => {
                logMessage(msg, tipo);
            });

            logMessage(`Processo concluído com sucesso. Realizados ${sucessos} lançamentos de aproveitamentos!`, 'success');
            showToast(`Sucesso: ${sucessos} notas salvas.`, 'success');
            
        } catch (err) {
            logMessage(`Interrompido por falha fatal na validação de APIs: ${err.message}`, 'error');
        } finally {
            btnConfirmarUpload.disabled = false;
            btnConfirmarUpload.classList.add('hidden'); // já processou
            btnCloseModal.disabled = false;
        }
    });

    // Modal Close
    btnCloseModal.addEventListener('click', () => {
        importModal.classList.add('hidden');
    });

    // --- Lógica Lançamento Direto --- //

    // Mapeamento dos combos
    selEscola.addEventListener('change', (e) => {
        selTurma.innerHTML = '<option value="">Selecione a Turma...</option>';
        selDisc.innerHTML = '<option value="">Selecione a Turma primeiro</option>';
        selTurma.disabled = false;
        selDisc.disabled = true;
        
        if (!e.target.value || !cacheDashboard) return;
        const esc = cacheDashboard.find(x => String(x.nome) === String(e.target.value));
        if (esc && esc.turmas) {
            esc.turmas.forEach(t => {
                let opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.nome;
                selTurma.appendChild(opt);
            });
        }
        validarBotaoCarregar();
    });

    selTurma.addEventListener('change', (e) => {
        selDisc.innerHTML = '<option value="">Selecione a Disciplina...</option>';
        selDisc.disabled = false;
        
        if (!e.target.value || !cacheDashboard) return;
        const esc = cacheDashboard.find(x => String(x.nome) === String(selEscola.value));
        if (esc) {
            const turm = esc.turmas.find(x => String(x.id) === String(e.target.value));
            if (turm && turm.disciplinas) {
                turm.disciplinas.forEach(d => {
                    let opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.disciplina || d.nome;
                    selDisc.appendChild(opt);
                });
            }
        }
        validarBotaoCarregar();
    });
    
    selDisc.addEventListener('change', validarBotaoCarregar);
    selPeriodoDiretor.addEventListener('change', validarBotaoCarregar);
    
    function validarBotaoCarregar() {
        if (selEscola.value && selTurma.value && selDisc.value && selPeriodoDiretor.value) {
            btnCarregarTabela.disabled = false;
        } else {
            btnCarregarTabela.disabled = true;
        }
    }

    btnCarregarTabela.addEventListener('click', async () => {
        const tId = selTurma.value;
        const dId = selDisc.value;
        const pId = selPeriodoDiretor.value;
        const perNome = selPeriodoDiretor.options[selPeriodoDiretor.selectedIndex].text;
        const isSemestre = perNome.toLowerCase().includes('sem');
        
        btnCarregarTabela.disabled = true;
        btnCarregarTabela.innerHTML = `<i data-lucide="loader" class="spinner-small"></i> Buscando Diários...`;
        if (window.lucide) window.lucide.createIcons();

        try {
            const data = await service.carregarDadosTabelaDireta(tId, dId, isSemestre, pId, service.cacheInfo.idRecHumano);
            renderizarDataGrid(data.instrumentos, data.alunos);
            gridContainer.classList.remove('hidden');
            footerAcoes.classList.remove('hidden');
            statePayloadsAguardos = {};
            atualizarFooter();
            showToast('Instrumentos e notas carregados com sucesso!', 'success');
        } catch (err) {
            showToast(`Erro ao abrir a tabela: ${err.message}`, 'error');
            gridContainer.classList.add('hidden');
            footerAcoes.classList.add('hidden');
        } finally {
            btnCarregarTabela.disabled = false;
            btnCarregarTabela.innerHTML = `<i data-lucide="search"></i> Buscar Instrumentos e Lançamentos`;
            if (window.lucide) window.lucide.createIcons();
        }
    });

    function renderizarDataGrid(instrumentos, alunos) {
        tbNotasHeadRow.innerHTML = `<th style="width: 80px;">Nº Matr.</th><th>Nome do Aluno</th>`;
        tbNotasBody.innerHTML = '';
        
        instrumentos.forEach(ins => {
            const th = document.createElement('th');
            th.innerHTML = `${ins.nome}<br><small style="color:var(--text-muted);font-weight:normal;">Peso: ${ins.peso || 1}</small>`;
            tbNotasHeadRow.appendChild(th);
        });

        alunos.forEach(alu => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span style="font-family:monospace; color:var(--text-muted);">${alu.matricula}</span></td>
                            <td style="font-weight: 500;">${alu.nome}</td>`;
            
            instrumentos.forEach(ins => {
                const td = document.createElement('td');
                const prevVal = alu.notas[ins.id] !== undefined ? alu.notas[ins.id] : '';
                
                const inp = document.createElement('input');
                inp.type = 'number';
                inp.step = '0.1';
                inp.min = '0';
                inp.max = '10';
                inp.className = 'grade-input';
                inp.value = prevVal;
                inp.setAttribute('data-id-aluno', alu.matricula);
                inp.setAttribute('data-id-inst', ins.id);
                inp.setAttribute('data-original-val', prevVal);
                
                inp.addEventListener('input', () => registrarMudancaGrid(inp));
                
                td.appendChild(inp);
                tr.appendChild(td);
            });
            
            tbNotasBody.appendChild(tr);
        });
    }

    function registrarMudancaGrid(inp) {
        const idA = inp.getAttribute('data-id-aluno');
        const idI = inp.getAttribute('data-id-inst');
        const oV = String(inp.getAttribute('data-original-val'));
        const nV = String(inp.value).trim();
        
        const key = `${idA}-${idI}`;
        
        if (nV !== oV && nV !== '') {
            inp.classList.add('changed');
            statePayloadsAguardos[key] = {
                payload: {
                    idInstrumento: parseInt(idI, 10),
                    idAluno: parseInt(idA, 10),
                    dsAproveitamento: parseFloat(nV),
                    dataRealizacao: new Date().toISOString().split('T')[0]
                },
                inputRef: inp
            };
        } else {
            inp.classList.remove('changed');
            delete statePayloadsAguardos[key];
        }
        
        atualizarFooter();
    }

    function atualizarFooter() {
        const count = Object.keys(statePayloadsAguardos).length;
        txtModificacoes.textContent = count === 0 ? "0 alterações pendentes" : `${count} avaliações prontas para gravação`;
        btnSalvarDireto.disabled = count === 0;
    }

    btnSalvarDireto.addEventListener('click', async () => {
        const ks = Object.keys(statePayloadsAguardos);
        if (ks.length === 0) return;
        
        const listToPost = ks.map(k => statePayloadsAguardos[k]);
        
        btnSalvarDireto.disabled = true;
        btnSalvarDireto.innerHTML = `<i data-lucide="loader" class="spinner-small"></i> Salvando (${listToPost.length})...`;
        if (window.lucide) window.lucide.createIcons();

        try {
            // Reutiliza endpoint em lote
            const enviosObj = listToPost.map(l => ({ payload: l.payload }));
            // Passamos um progress callback mock porque na Grid Direct não temos barra
            await service.enviarNotas(enviosObj, 
                (p) => {}, 
                (logMsg, tpo) => { console.log("[Direct Save]", logMsg); }
            );

            showToast(`Sucesso! ${listToPost.length} notas sincronizadas com a SEDUC.`, 'success');
            
            // Aceita como originais agora
            listToPost.forEach(item => {
                item.inputRef.classList.remove('changed');
                item.inputRef.classList.add('saved');
                item.inputRef.setAttribute('data-original-val', item.payload.dsAproveitamento);
                setTimeout(() => item.inputRef.classList.remove('saved'), 3000);
            });
            statePayloadsAguardos = {};
            atualizarFooter();

        } catch (err) {
            showToast(`Falha no envio direto: ${err.message}`, 'error');
        } finally {
            btnSalvarDireto.innerHTML = `<i data-lucide="save"></i> Salvar Lançamentos na EscolaRS`;
            btnSalvarDireto.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }
    });

    // Globais
    function logMessage(text, tipo) {
        const d = document.createElement('div');
        d.className = tipo;
        d.textContent = `> ${text}`;
        importLog.appendChild(d);
        importLog.scrollTop = importLog.scrollHeight;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'alert-circle';
        if (type === 'warning') icon = 'alert-triangle';

        toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);
        
        // Ativa lucide para itens injetados
        if (window.lucide) window.lucide.createIcons();

        setTimeout(() => toast.remove(), 5000);
    }
});
