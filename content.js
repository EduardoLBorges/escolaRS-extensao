/**
 * Content Script da Extensão EscolaRS
 * Injetado em professor.escola.rs.gov.br e www.soe.rs.gov.br
 * Objetivo: Capturar tokens (access e refresh) e nrDoc invisivelmente para uso nas requisições em background.
 */

function saveNrDocIfFound(val) {
  if (!val) return;
  const clean = String(val).trim().replace(/\D/g, '');
  if (clean.length >= 7 && clean.length <= 14) {
    chrome.storage.local.get('nrDoc', (res) => {
      if (res.nrDoc !== clean) {
        chrome.storage.local.set({ nrDoc: clean }, () => {
          console.log('[EscolaRS Extensão] nrDoc capturado automaticamente:', clean);
        });
      }
    });
  }
}

function extractDocFromJwt(jwtStr) {
  try {
    const raw = String(jwtStr).replace(/^Bearer\s+/i, '');
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.nrDoc || payload.cpf || payload.preferred_username || payload.sub || null;
  } catch {
    return null;
  }
}

function captureIndexedDbInfo() {
  try {
    if (typeof indexedDB === 'undefined') return;
    const request = indexedDB.open('ise_professor');
    request.onerror = () => {};
    request.onsuccess = (event) => {
      try {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('usuario')) return;
        const transaction = db.transaction(['usuario'], 'readonly');
        const objectStore = transaction.objectStore('usuario');
        const cursorRequest = objectStore.openCursor();
        const storeData = {};
        cursorRequest.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            storeData[cursor.key] = cursor.value;
            cursor.continue();
          } else {
            const doc = storeData['nrDoc'] || (storeData['usuario'] && storeData['usuario'].nrDoc);
            if (doc) saveNrDocIfFound(doc);
          }
        };
      } catch (e) {}
    };
  } catch (e) {}
}

function captureOidcInfo() {
  try {
    const storages = [localStorage, sessionStorage];
    storages.forEach(storage => {
      if (!storage) return;

      const directDoc = storage.getItem('nrDoc') || storage.getItem('cpf');
      if (directDoc) saveNrDocIfFound(directDoc);

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        const val = storage.getItem(key);
        if (val && val.includes('refresh_token')) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.refresh_token) {
              chrome.storage.local.get('escolaRsRefreshToken', (res) => {
                if (res.escolaRsRefreshToken !== parsed.refresh_token) {
                  chrome.storage.local.set({ escolaRsRefreshToken: parsed.refresh_token }, () => {
                    console.log('[EscolaRS Extensão] Refresh token capturado automaticamente do storage key:', key);
                  });
                }
              });
            }
            if (parsed.access_token && parsed.token_type) {
              const fullToken = `${parsed.token_type} ${parsed.access_token}`;
              chrome.storage.local.get('escolaRsToken', (res) => {
                if (res.escolaRsToken !== fullToken) {
                  chrome.storage.local.set({ escolaRsToken: fullToken });
                }
              });
              const docFromAccess = extractDocFromJwt(parsed.access_token);
              if (docFromAccess) saveNrDocIfFound(docFromAccess);
            }
            if (parsed.id_token) {
              const docFromId = extractDocFromJwt(parsed.id_token);
              if (docFromId) saveNrDocIfFound(docFromId);
            }
            if (parsed.profile) {
              const profileDoc = parsed.profile.nrDoc || parsed.profile.cpf || parsed.profile.preferred_username || parsed.profile.sub;
              if (profileDoc) saveNrDocIfFound(profileDoc);
            }
          } catch (e) {
            // Ignora se não for JSON válido
          }
        }
      }
    });
  } catch (err) {
    console.warn('[EscolaRS Extensão] Erro ao tentar extrair dados OIDC do storage:', err);
  }
}

// Executa a captura na inicialização e após breve intervalo (garante carregamento de IndexedDB)
captureOidcInfo();
captureIndexedDbInfo();
setTimeout(() => {
  captureOidcInfo();
  captureIndexedDbInfo();
}, 1500);

// Ouve qualquer alteração feita no storage pelo front-end do portal
window.addEventListener('storage', () => {
  captureOidcInfo();
  captureIndexedDbInfo();
});
