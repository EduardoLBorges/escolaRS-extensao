console.log('[EscolaRS Ext] Content script injetado.');

/**
 * Captura dados de autenticação (token, nrDoc, idRecHumano) do IndexedDB do site
 * e os salva no chrome.storage.local para o background script usar.
 * @returns {Promise<boolean>} Resolve `true` se os dados foram encontrados e salvos, `false` caso contrário.
 */
function captureAuthData() {
  return new Promise((resolve, reject) => {
    // Acessa o banco de dados do site
    const request = indexedDB.open("ise_professor");

    request.onerror = (event) => {
      console.error("[EscolaRS Ext] Erro ao acessar IndexedDB:", event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      try {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("usuario")) {
          console.warn("[EscolaRS Ext] Object store 'usuario' não encontrado.");
          resolve(false);
          return;
        }

        const transaction = db.transaction(["usuario"], "readonly");
        const objectStore = transaction.objectStore("usuario");
        const cursorRequest = objectStore.openCursor();
        const storeData = {};

        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            storeData[cursor.key] = cursor.value;
            cursor.continue();
          } else {
            // O cursor terminou de iterar
            console.log('[EscolaRS Ext] Keys found in IndexedDB:', Object.keys(storeData));

            const authData = {};
            const tokenValue = storeData['jwt'] || storeData['token'];
            const nrDocValue = storeData['nrDoc'];

            if (tokenValue) {
              authData.escolaRsToken = `Bearer ${tokenValue}`;
            }
            if (nrDocValue) {
              authData.nrDoc = nrDocValue;
            }

            if (authData.escolaRsToken && authData.nrDoc) {
              chrome.storage.local.set(authData, () => {
                console.log('[EscolaRS Ext] Dados de autenticação (Token e CPF) salvos no storage.');
                resolve(true);
              });
            } else {
              console.warn("[EscolaRS Ext] Token ou nrDoc não encontrados no IndexedDB.");
              resolve(false);
            }
          }
        };

        cursorRequest.onerror = (event) => {
            console.error("[EscolaRS Ext] Erro ao ler dados do object store com cursor:", event.target.error);
            reject(event.target.error);
        };
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * Tenta capturar os dados repetidamente até ter sucesso ou atingir um limite.
 * O site (SPA) pode demorar para popular o IndexedDB.
 */
async function initializeAuthCapture() {
  let attempts = 0;
  const maxAttempts = 5;
  const delay = 2000; // ms

  while (attempts < maxAttempts) {
    console.log(`[EscolaRS Ext] Tentativa ${attempts + 1} de capturar autenticação...`);
    const captured = await captureAuthData().catch(() => false);
    if (captured) {
      console.log("[EscolaRS Ext] Captura de autenticação bem-sucedida.");
      return;
    }
    attempts++;
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error("[EscolaRS Ext] Falha ao capturar dados de autenticação após várias tentativas.");
}

// Inicia o processo de captura assim que o script é injetado.
initializeAuthCapture();
