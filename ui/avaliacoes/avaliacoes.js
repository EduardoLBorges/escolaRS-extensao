/**
 * avaliacoes.js - Controlador da UI de Avaliações (Multi-Tab)
 */

const service = new AvaliacoesService();

class TabController {
    constructor(id, viewEl, btnEl) {
        this.id = id;
        this.viewEl = viewEl;
        this.btnEl = btnEl;
        this.statePayloads = {};

        this.cardsView = viewEl.querySelector('.cards-view-container');
        this.cardsGrid = viewEl.querySelector('.cards-grid-container');
        this.cardsLoading = viewEl.querySelector('.cards-loading');
        
        this.gridHeader = viewEl.querySelector('.grid-header');
        this.gridTitle = viewEl.querySelector('.grid-title');
        this.gridSubtitle = viewEl.querySelector('.grid-subtitle');
        this.btnVoltarCards = viewEl.querySelector('.btn-voltar-cards');
        
        this.gridContainer = viewEl.querySelector('.grid-container-wrapper');
        this.headRow = viewEl.querySelector('.tb-notas-head-row');
        this.bodyRow = viewEl.querySelector('.tb-notas-body');
        
        this.footerAcoes = viewEl.querySelector('.footer-acoes');
        this.txtModifs = viewEl.querySelector('.txt-modificacoes');
        this.btnPreencherZeros = viewEl.querySelector('.btn-preencher-zeros');
        this.btnSalvar = viewEl.querySelector('.btn-salvar-direto');

        this.initCardsEvents();
        setTimeout(() => this.renderizarCardsTurmas(), 200);
    }

    initCardsEvents() {
        this.btnVoltarCards.addEventListener('click', () => {
            this.gridContainer.classList.add('hidden');
            this.footerAcoes.classList.add('hidden');
            this.gridHeader.classList.add('hidden');
            this.cardsView.classList.remove('hidden');
            
            const span = this.btnEl.querySelector('span');
            if(span) span.textContent = 'Nova aba';
        });
        
        this.bodyRow.addEventListener('keydown', (e) => this.navegarComSetas(e));
        this.btnPreencherZeros.addEventListener('click', () => this.preencherVaziosComZero());
        this.btnSalvar.addEventListener('click', () => this.salvarDadosLote());
    }

    preencherVaziosComZero() {
        let count = 0;
        const inputs = this.bodyRow.querySelectorAll('.grade-input');
        inputs.forEach(inp => {
            if (inp.value.trim() === '') {
                inp.value = '0';
                this.registrarMudanca(inp);
                count++;
            }
        });
        
        if (count > 0) {
            window.showToast(`${count} lacunas preenchidas com nota 0.`, 'info');
        } else {
            window.showToast(`Nenhuma lacuna vazia encontrada nesta tabela.`, 'info');
        }
    }

    async renderizarCardsTurmas() {
        this.cardsGrid.innerHTML = '';
        if (!window.cacheDashboard || window.cacheDashboard.length === 0) {
            this.cardsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma turma encontrada no cache. Abra o Dashboard primeiro.</div>';
            return;
        }

        const cardsToFetch = [];

        window.cacheDashboard.forEach(esc => {
            const section = document.createElement('div');
            section.className = 'escola-section';
            
            const title = document.createElement('h3');
            title.style.cssText = 'margin-bottom: 15px; font-size: 1.1rem; color: var(--text-muted); border-bottom: 1px solid var(--border); padding-bottom: 8px; font-weight: 600;';
            title.textContent = esc.nome;
            section.appendChild(title);

            const grid = document.createElement('div');
            grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;';

            let disciplinasList = [];
            
            if (esc.turmas) {
                esc.turmas.forEach(tur => {
                    if (tur.disciplinas) {
                        tur.disciplinas.forEach(disc => {
                            disciplinasList.push({ tur, disc });
                        });
                    }
                });
            }

            // Ordenar em ordem alfanumérica pelo nome (ex: "71 - Matemática")
            disciplinasList.sort((a, b) => {
                const nameA = `${a.tur.nome} - ${a.disc.disciplina || a.disc.nome}`;
                const nameB = `${b.tur.nome} - ${b.disc.disciplina || b.disc.nome}`;
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            });

            disciplinasList.forEach(item => {
                const tur = item.tur;
                const disc = item.disc;
                const cardTitle = `${tur.nome} - ${disc.disciplina || disc.nome}`;

                const card = document.createElement('div');
                card.className = 'turma-card';
                card.innerHTML = `
                    <div class="turma-card-header">
                        <h4 class="turma-card-title">${cardTitle}</h4>
                    </div>
                    <div class="turma-card-instruments">
                        <span class="instrument-loading-tag">Carregando instrumentos...</span>
                    </div>
                `;

                card.addEventListener('click', () => this.carregarTabela(esc, tur, disc));
                grid.appendChild(card);

                cardsToFetch.push({
                    cardEl: card,
                    turmaId: tur.id,
                    discId: disc.id,
                    idRecHumano: service.cacheInfo.idRecHumano
                });
            });

            if (disciplinasList.length > 0) {
                section.appendChild(grid);
                this.cardsGrid.appendChild(section);
            }
        });

        // Fetch instruments in background (batched)
        this.carregarInstrumentosNosCards(cardsToFetch);
    }

    async carregarInstrumentosNosCards(cardsData) {
        if (!cardsData || cardsData.length === 0) return;
        this.cardsLoading.classList.remove('hidden');
        
        const batchSize = 3;
        for (let i = 0; i < cardsData.length; i += batchSize) {
            const batch = cardsData.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (data) => {
                try {
                    // Usando o client oficial da API que faz silent refresh e tratamentos de 401
                    const arrayAvals = await fetchEscolaRS(`listarAvaliacoesTurma/${data.turmaId}/${data.discId}/${data.idRecHumano}`, service.cacheInfo.token);
                    
                    const selectPeriodoGlobal = document.getElementById('selectPeriodo');
                    const pId = selectPeriodoGlobal ? selectPeriodoGlobal.value : null;
                    
                    let instrumentosApi = [];
                    if (pId) {
                         const periodoEncontrado = arrayAvals.find(a => parseInt(a.id) === parseInt(pId));
                         if (periodoEncontrado && periodoEncontrado.instrumentos) instrumentosApi = periodoEncontrado.instrumentos;
                    } else {
                         // Sem período, pega do primeiro período ativo ou junta todos
                         if (arrayAvals[0] && arrayAvals[0].instrumentos) instrumentosApi = arrayAvals[0].instrumentos;
                    }

                    const container = data.cardEl.querySelector('.turma-card-instruments');
                    container.innerHTML = '';
                    if (instrumentosApi.length === 0) {
                        container.innerHTML = '<span class="instrument-tag" style="background:#fef2f2; color:#991b1b;">Sem instrumentos no período</span>';
                    } else {
                        instrumentosApi.forEach(inst => {
                            const tag = document.createElement('span');
                            tag.className = 'instrument-tag';
                            tag.textContent = inst.nome;
                            tag.title = inst.nome;
                            container.appendChild(tag);
                        });
                    }
                } catch (e) {
                    const container = data.cardEl.querySelector('.turma-card-instruments');
                    container.innerHTML = '<span class="instrument-tag" style="background:#fef2f2; color:#991b1b;">Erro ao carregar</span>';
                }
            }));
        }
        
        this.cardsLoading.classList.add('hidden');
    }

    async carregarTabela(escola, turma, disciplina) {
        const selectPeriodoGlobal = document.getElementById('selectPeriodo');
        const pId = selectPeriodoGlobal ? selectPeriodoGlobal.value : null;
        
        if (!pId) {
            window.showToast('Selecione um Período no cabeçalho superior primeiro.', 'warning');
            return;
        }

        const perNome = selectPeriodoGlobal.options[selectPeriodoGlobal.selectedIndex].text;
        const isSemestre = perNome.toLowerCase().includes('sem');
        
        const discNome = disciplina.disciplina || disciplina.nome;
        const turmNome = turma.nome;
        
        this.cardsView.classList.add('hidden');
        
        this.gridTitle.textContent = `${discNome}`;
        this.gridSubtitle.textContent = `${escola.nome} • ${turmNome} • ${perNome}`;
        this.gridHeader.classList.remove('hidden');

        const iconOriginal = this.gridTitle.innerHTML;
        this.gridTitle.innerHTML = `<i data-lucide="loader" class="spinner-small" style="display:inline-block; margin-right:8px;"></i> Carregando...`;
        if (window.lucide) window.lucide.createIcons();

        try {
            const data = await service.carregarDadosTabelaDireta(turma.id, disciplina.id, isSemestre, pId, service.cacheInfo.idRecHumano);
            this.renderizarDataGrid(data.instrumentos, data.alunos);
            
            this.gridContainer.classList.remove('hidden');
            this.footerAcoes.classList.remove('hidden');
            this.statePayloads = {};
            this.atualizarFooter();
            
            const span = this.btnEl.querySelector('span');
            if(span) span.textContent = `${discNome} / ${turmNome.substring(0,6)}`;
            
            window.showToast(`(Aba) Carregado: ${data.alunos.length} alunos!`, 'success');
        } catch (err) {
            window.showToast(`(Aba) Erro: ${err.message}`, 'error');
            this.cardsView.classList.remove('hidden');
            this.gridHeader.classList.add('hidden');
        } finally {
            this.gridTitle.textContent = discNome;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    renderizarDataGrid(instrumentos, alunos) {
        this.headRow.innerHTML = `<th style="width: 80px;">Nº Matr.</th><th>Nome do Aluno</th>`;
        this.bodyRow.innerHTML = '';
        
        instrumentos.forEach(ins => {
            const th = document.createElement('th');
            th.innerHTML = `${ins.nome}<br><small style="color:var(--text-muted);font-weight:normal;">Peso: ${ins.peso || 1}</small>`;
            this.headRow.appendChild(th);
        });

        alunos.forEach(alu => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="cell-text"><span style="font-family:monospace; color:var(--text-muted);">${alu.matricula}</span></td>
                            <td class="cell-text" style="font-weight: 500;">${alu.nome}</td>`;
            
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
                
                let dataParaEnvio = ins.dataAplicacao || ins.dataRealizacao || ins.data;
                const dataMat = alu.dataMatricula; 
                const hojeStr = new Date().toISOString().split('T')[0];

                if (dataParaEnvio && dataMat) {
                    const dInst = new Date(dataParaEnvio);
                    const dMat = new Date(dataMat);
                    if (dMat > dInst) {
                        dataParaEnvio = hojeStr;
                    }
                } else if (!dataParaEnvio) {
                    dataParaEnvio = hojeStr;
                }
           
                inp.setAttribute('data-data-realizacao', dataParaEnvio);
                
                inp.addEventListener('input', () => this.registrarMudanca(inp));
                
                td.appendChild(inp);
                tr.appendChild(td);
            });
            
            this.bodyRow.appendChild(tr);
        });
    }

    registrarMudanca(inp) {
        const idA = inp.getAttribute('data-id-aluno');
        const idI = inp.getAttribute('data-id-inst');
        const oV = String(inp.getAttribute('data-original-val'));
        const nV = String(inp.value).trim();
    
        const dataResolvida = inp.getAttribute('data-data-realizacao');
        
        const key = `${idA}-${idI}`;
        
        if (nV !== oV && nV !== '') {
            inp.classList.add('changed');
            this.statePayloads[key] = {
                payload: {
                    idInstrumento: parseInt(idI, 10),
                    idAluno: parseInt(idA, 10),
                    dsAproveitamento: parseFloat(nV),
                    dataRealizacao: dataResolvida 
                },
                inputRef: inp
            };
        } else {
            inp.classList.remove('changed');
            delete this.statePayloads[key];
        }
        
        this.atualizarFooter();
    }
    
    atualizarFooter() {
        const count = Object.keys(this.statePayloads).length;
        this.txtModifs.textContent = count === 0 ? "0 alterações na aba" : `${count} avaliações prontas para gravação`;
        this.btnSalvar.disabled = count === 0;
    }

    async salvarDadosLote() {
        const ks = Object.keys(this.statePayloads);
        if (ks.length === 0) return;
        
        const listToPost = ks.map(k => this.statePayloads[k]);
        
        this.btnSalvar.disabled = true;
        this.btnSalvar.innerHTML = `<i data-lucide="loader" class="spinner-small"></i> Salvando...`;
        if (window.lucide) window.lucide.createIcons();

        try {
            const enviosObj = listToPost.map(l => ({ payload: l.payload }));
            await service.enviarNotas(enviosObj, 
                (p) => {}, 
                (logMsg, tpo) => { console.log(`[Aba ${this.id}]`, logMsg); }
            );

            window.showToast(`Sucesso! ${listToPost.length} notas gravadas.`, 'success');
            
            listToPost.forEach(item => {
                item.inputRef.classList.remove('changed');
                item.inputRef.classList.add('saved');
                item.inputRef.setAttribute('data-original-val', item.payload.dsAproveitamento);
                setTimeout(() => item.inputRef.classList.remove('saved'), 3000);
            });
            this.statePayloads = {};
            this.atualizarFooter();

        } catch (err) {
            window.showToast(`Falha no envio da Aba: ${err.message}`, 'error');
        } finally {
            this.btnSalvar.innerHTML = `<i data-lucide="save"></i> Salvar Lançamentos Aba`;
            this.btnSalvar.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    navegarComSetas(e) {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;

        const currentInput = e.target;
        
        if (!currentInput.classList.contains('grade-input')) return;

        const currentTd = currentInput.closest('td');
        const currentTr = currentInput.closest('tr');
        if (!currentTd || !currentTr) return;

        const cellIndex = Array.from(currentTr.children).indexOf(currentTd);
        let targetRow = null;
        let targetCell = null;

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            targetRow = currentTr.previousElementSibling;
            if (targetRow) targetCell = targetRow.children[cellIndex];
        } 
        else if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault();
            targetRow = currentTr.nextElementSibling;
            if (targetRow) targetCell = targetRow.children[cellIndex];
        }
        else if (e.key === 'ArrowLeft') {
            targetCell = currentTd.previousElementSibling;
        }
        else if (e.key === 'ArrowRight') {
            targetCell = currentTd.nextElementSibling;
        }
        if (targetCell) {
            const nextInput = targetCell.querySelector('.grade-input');
            if (nextInput) {
                if (['ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault(); 
                
                nextInput.focus();
                
                nextInput.select(); 
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) window.lucide.createIcons();

    const loadingState = document.getElementById('loading');
    const tabsContainer = document.getElementById('tabsContainer');
    const tabsList = document.getElementById('tabsList');
    const tabViewsContainer = document.getElementById('tabViewsContainer');
    const btnNovaAba = document.getElementById('btnNovaAba');
    const tabTemplate = document.getElementById('tabTemplate');
    
    // Globais do Header
    const selectPeriodo = document.getElementById('selectPeriodo');
    const btnExport = document.getElementById('btnExport');
    const btnImport = document.getElementById('btnImport');
    const fileUpload = document.getElementById('fileUpload');
    const btnVoltar = document.getElementById('btnVoltar');
    
    // Import Modal globais
    const importModal = document.getElementById('importModal');
    const importLog = document.getElementById('importLog');
    const importStatus = document.getElementById('importStatus');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnConfirmarUpload = document.getElementById('btnConfirmarUpload');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');

    // Expondo vars pro Escopo da Classe Externa
    window.cacheDashboard = null;
    window.periodosGlobais = [];
    let preparedPayloads = [];

    // Gerenciamento de Abas
    let tabCount = 0;
    let activeTabId = null;
    const tabsData = new Map(); // id -> Tab Instance

    // Exportar globais que a classe precisa chamar
    window.showToast = showToast;

    // --- Inicia a Visualização --- //
    try {
        await service.init();
        
        // Puxar os períodos
        window.periodosGlobais = await service.carregarPeriodos();
        selectPeriodo.innerHTML = '<option value="">Obrigatório...</option>';

        if (window.periodosGlobais.length > 0) {
            window.periodosGlobais.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.descricao;
                selectPeriodo.appendChild(opt);
            });
            selectPeriodo.selectedIndex = 1;
        }

        // Carregar dados de Escolas do cache do dashboard para os combos
        const stData = await chrome.storage.local.get(['dashboardCache']);
        if (stData.dashboardCache && stData.dashboardCache.data) {
            window.cacheDashboard = stData.dashboardCache.data.escolas;
        } else {
            showToast('Nenhum dado de turmas no cache. Abra o Dashboard primeiro.', 'warning');
            cacheDashboard = [];
        }

        loadingState.classList.add('hidden');
        tabsContainer.classList.remove('hidden');
        
        // Inicializar a primeira aba automaticamente
        criarAba();

    } catch (err) {
        showToast(`Erro na inicialização: ${err.message}`, 'error');
        loadingState.innerHTML = `<p style="color:var(--error);">Falha: ${err.message}</p>`;
    }

    btnVoltar.addEventListener('click', () => {
        window.location.href = '../chamada/chamada.html';
    });

    // --- Módulo Multi-Abas --- //

    btnNovaAba.addEventListener('click', () => criarAba());

    function criarAba() {
        tabCount++;
        const tId = `tab-${tabCount}`;
        
        // 1. Criar Botão da Aba
        const btn = document.createElement('button');
        btn.className = 'tab-button tab-label';
        btn.innerHTML = `<span>Nova aba</span> <div class="tab-close" data-target="${tId}"><i data-lucide="x"></i></div>`;
        btn.addEventListener('click', (e) => {
            if(e.target.closest('.tab-close')) return; // ignora se clicou no fechar
            alternarAba(tId);
        });
        tabsList.appendChild(btn);

        // Evento de Fcehar
        btn.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            fecharAba(tId);
        });

        // 2. Instanciar View da Aba
        const clone = tabTemplate.content.cloneNode(true);
        const viewEl = clone.querySelector('.tab-view');
        viewEl.id = tId;
        tabViewsContainer.appendChild(clone);

        // 3. Classe de controle local
        const tabInstance = new TabController(tId, viewEl, btn);
        tabsData.set(tId, tabInstance);
        
        alternarAba(tId);
        if (window.lucide) window.lucide.createIcons();
    }

    function alternarAba(id) {
        if (!tabsData.has(id)) return;
        
        // Ocultar todas
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-view').forEach(v => {
            v.classList.remove('active-view');
            v.classList.add('hidden');
        });

        const instance = tabsData.get(id);
        instance.btnEl.classList.add('active');
        instance.viewEl.classList.add('active-view');
        instance.viewEl.classList.remove('hidden');
        activeTabId = id;
    }

    function fecharAba(id) {
        if (!tabsData.has(id)) return;
        const instance = tabsData.get(id);
        
        instance.btnEl.remove();
        instance.viewEl.remove();
        tabsData.delete(id);
        
        // Se fechou a aba atual, foca em outra
        if (activeTabId === id) {
            const remaining = Array.from(tabsData.keys());
            if (remaining.length > 0) {
                alternarAba(remaining[remaining.length - 1]);
            } else {
                activeTabId = null;
                // Abre uma nova aba limpa se fechar a ultima?
                criarAba(); 
            }
        }
    }



    // --- Sistema Legado: Exportação em Lote pelo Top Header --- //
    btnExport.addEventListener('click', async () => {
        const pId = selectPeriodo.value;
        if (!pId) {
            showToast('Top Header: Selecione o período antes de exportar o lote global.', 'warning');
            return;
        }
        
        btnExport.disabled = true;
        const originalText = btnExport.innerHTML;
        
        try {
            await service.exportarMassa(pId, (prog) => {
                btnExport.innerHTML = `<i data-lucide="loader" class="spinner-small"></i> ${prog.pct}%`;
            });
            showToast('Arquivos de lote baixados com sucesso!', 'success');
        } catch (err) {
            showToast(`Erro na exportação em lote: ${err.message}`, 'error');
        } finally {
            btnExport.disabled = false;
            btnExport.innerHTML = originalText;
        }
    });

    // --- Fluxo de Importação pelo Top Header --- //
    btnImport.addEventListener('click', () => fileUpload.click());

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset state
        importStatus.textContent = `(${file.name})`;
        importLog.innerHTML = `<div class="info">Lendo arquivo excel massivo...</div>`;
        btnConfirmarUpload.classList.add('hidden');
        uploadProgressContainer.classList.add('hidden');
        importModal.classList.remove('hidden');
        preparedPayloads = [];

        try {
            preparedPayloads = await service.parseUploadedFile(file);
            if (preparedPayloads.length === 0) {
                logMessage('Nenhuma nota com ID detectada no arquivo global.', 'error');
                return;
            }

            logMessage(`Foram detectadas ${preparedPayloads.length} avaliações para atualizar massivamente.`, 'success');
            btnConfirmarUpload.classList.remove('hidden');

        } catch (err) {
            logMessage(`Falha Excel: ${err.message}`, 'error');
        } finally {
            fileUpload.value = '';
        }
    });

    btnConfirmarUpload.addEventListener('click', async () => {
        btnConfirmarUpload.disabled = true;
        btnCloseModal.disabled = true;
        uploadProgressContainer.classList.remove('hidden');
        uploadProgressBar.style.width = '0%';

        try {
            const sucessos = await service.enviarNotas(preparedPayloads, 
            (prog) => uploadProgressBar.style.width = `${prog.pct}%`, 
            (msg, tipo) => logMessage(msg, tipo));

            logMessage(`Massivo concluído: ${sucessos} lançamentos validados!`, 'success');
            showToast(`Lote Global: ${sucessos} notas salvas.`, 'success');
            
        } catch (err) {
            logMessage(`Interrompido: ${err.message}`, 'error');
        } finally {
            btnConfirmarUpload.disabled = false;
            btnConfirmarUpload.classList.add('hidden');
            btnCloseModal.disabled = false;
        }
    });

    btnCloseModal.addEventListener('click', () => importModal.classList.add('hidden'));

    // --- Helpers Utilitários --- //
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
        
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => toast.remove(), 5000);
    }
});
