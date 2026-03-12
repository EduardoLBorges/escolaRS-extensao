
/**
 * Captura o nrDoc (número de documento do professor) do IndexedDB do site
 * e salva no chrome.storage.local para o background script usar.
 * 
 * O token de autenticação é capturado separadamente pelo webRequest listener
 * no background.js, dispensando a leitura do JWT aqui.
 * 
 * @returns {Promise<boolean>} Resolve `true` se o nrDoc foi encontrado e salvo.
 */
function captureAuthData() {
  return new Promise((resolve, reject) => {
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
            const nrDoc = storeData['nrDoc'];

            if (nrDoc) {
              chrome.storage.local.set({ nrDoc }, () => {
                console.log("[EscolaRS Ext] nrDoc capturado e salvo.");
                resolve(true);
              });
            } else {
              console.warn("[EscolaRS Ext] nrDoc não encontrado no IndexedDB.");
              resolve(false);
            }
          }
        };

        cursorRequest.onerror = (event) => {
          console.error("[EscolaRS Ext] Erro ao ler IndexedDB:", event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * Tenta capturar o nrDoc repetidamente até ter sucesso ou atingir o limite.
 * O SPA pode demorar para popular o IndexedDB após o login.
 */
async function initializeAuthCapture() {
  let attempts = 0;
  const maxAttempts = 5;
  const delay = 2000; // ms

  while (attempts < maxAttempts) {
    const captured = await captureAuthData().catch(() => false);
    if (captured) return;

    attempts++;
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error("[EscolaRS Ext] Falha ao capturar nrDoc após várias tentativas.");
}

initializeAuthCapture();
