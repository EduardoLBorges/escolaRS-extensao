// Acessa o IndexedDB do site para capturar Token e CPF
function capturarDadosDB() {
  const request = indexedDB.open("ise_professor");

  request.onerror = () => console.error("EscolaRS Export: Erro ao acessar DB.");

  request.onsuccess = (event) => {
    const db = event.target.result;
    
    if (!db.objectStoreNames.contains("usuario")) return;

    const transaction = db.transaction(["usuario"], "readonly");
    const objectStore = transaction.objectStore("usuario");

    objectStore.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const key = cursor.key;
        const value = cursor.value;

        // Salva Token
        if (key === "jwt" || key === "token") {
          chrome.storage.local.set({ "escolaRsToken": `Bearer ${value}` });
        }
        
        // Salva CPF (nrDoc)
        if (key === "nrDoc") {
           chrome.storage.local.set({ "nrDoc": value });
        } else if (value && value.nrDoc) {
           chrome.storage.local.set({ "nrDoc": value.nrDoc });
        }

        cursor.continue();
      }
    };
  };
}

// Tenta capturar ao carregar e novamente após 2 segundos (garantia de carregamento do site)
capturarDadosDB();
setTimeout(capturarDadosDB, 2000);