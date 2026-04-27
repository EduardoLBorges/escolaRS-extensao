/**
 * avaliacoes.js - Controlador da UI de Avaliações em Massa
 */

const service = new AvaliacoesService();

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) window.lucide.createIcons();

    const loadingState = document.getElementById('loading');
    const layout = document.getElementById('avaliacoesContainer');
    const btnVoltar = document.getElementById('btnVoltar');
    const selectPeriodo = document.getElementById('selectPeriodo');
    
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
        const periodos = await service.carregarPeriodos();
        selectPeriodo.innerHTML = '<option value="">Selecione...</option>';
        if (periodos.length > 0) {
            periodos.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.descricao;
                selectPeriodo.appendChild(opt);
            });
            // Auto selecionar o atual se possível
            selectPeriodo.selectedIndex = 1;
        } else {
            selectPeriodo.innerHTML = '<option value="">(Nenhum período validado na API)</option>';
        }

        loadingState.classList.add('hidden');
        layout.classList.remove('hidden');
    } catch (err) {
        showToast(`Erro na inicialização: ${err.message}`, 'error');
        loadingState.innerHTML = `<p style="color:var(--error);">Falha: ${err.message}</p>`;
    }

    // --- Navegação --- //
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
