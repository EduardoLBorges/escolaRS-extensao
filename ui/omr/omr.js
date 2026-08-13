/**
 * omr.js — Controller da página principal do módulo OMR (Navegação de abas e eventos globais)
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Tab switching (Gerador <-> Leitor)
  document.querySelectorAll('.tab-nav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const targetBtn = e.target.closest('.tab-nav-btn') || btn;
      const tabName = targetBtn.dataset.tab;
      if (!tabName) return;

      document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));

      targetBtn.classList.add('active');
      const targetContent = document.getElementById(`tab-${tabName}`);
      if (targetContent) {
        targetContent.classList.remove('hidden');
      }
    });
  });

  // Botão Voltar para a chamada
  const btnVoltar = document.getElementById('btnVoltar');
  if (btnVoltar) {
    btnVoltar.addEventListener('click', () => {
      window.location.href = '../chamada/chamada.html';
    });
  }

  if (window.lucide) window.lucide.createIcons();
});
