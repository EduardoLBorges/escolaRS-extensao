console.log("EscolaRS Extensão: Iniciando busca no IndexedDB...");

function capturarDadosDB() {
  // Tenta abrir o banco
  const request = indexedDB.open("ise_professor");

  request.onerror = (e) => console.error("Erro ao abrir banco:", e);

  request.onsuccess = (event) => {
    const db = event.target.result;
    
    // Verifica se a store 'usuario' existe
    if (!db.objectStoreNames.contains("usuario")) {
      console.error("Store 'usuario' não encontrada no banco ise_professor");
      return;
    }

    const transaction = db.transaction(["usuario"], "readonly");
    const objectStore = transaction.objectStore("usuario");

    // Vamos usar um cursor para ler TODAS as chaves da store 'usuario'
    // Isso evita erro se o nome da chave for diferente
    objectStore.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const key = cursor.key;
        const value = cursor.value;
        
        console.log(`Chave encontrada: ${key}`, value);

        // Lógica de captura baseada na chave ou no valor
        if (key === "jwt" || key === "token") {
          chrome.storage.local.set({ "escolaRsToken": `Bearer ${value}` });
          console.log("Token Salvo!");
        }
        
        // Se a chave for nrDoc OU se for um objeto contendo nrDoc
        if (key === "nrDoc") {
           chrome.storage.local.set({ "nrDoc": value });
           console.log("NrDoc Salvo (chave direta)!");
        } else if (value && value.nrDoc) {
           chrome.storage.local.set({ "nrDoc": value.nrDoc });
           console.log("NrDoc Salvo (dentro de objeto)!");
        }

        cursor.continue();
      } else {
        console.log("Fim da varredura do IndexedDB.");
      }
    };
  };
}

// Executa e tenta novamente após 2 segundos (garantia de carregamento)
capturarDadosDB();
setTimeout(capturarDadosDB, 2000);