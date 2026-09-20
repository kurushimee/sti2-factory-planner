(() => {
  let worker;
  const messages = [], files = [];
  let selectedArchive;
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('factory-planner', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('plans');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  window.plannerBridge = {
    submit(job) {
      this.cancel();
      const importing = job.kind === 'import_world';
      worker = new Worker(importing ? 'kernel/world-worker.js' : 'kernel/worker.js', {type: 'module'});
      worker.onmessage = event => messages.push(event.data);
      worker.onerror = event => messages.push({id: job.id, error: event.message});
      if (importing) {
        if (!selectedArchive) { messages.push({id: job.id, error: 'Choose a world ZIP before importing.'}); return; }
        const bytes = selectedArchive.slice(0);
        worker.postMessage({...job, bytes}, [bytes]);
      } else worker.postMessage(job);
    },
    cancel() { worker?.terminate(); worker = null; messages.length = 0; },
    poll() { return messages.length ? JSON.stringify(messages.shift()) : ''; },
    pollFile() { return files.length ? JSON.stringify(files.shift()) : ''; },
    chooseFile() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,.zip';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          if (file.name.toLowerCase().endsWith('.zip')) {
            selectedArchive = await file.arrayBuffer();
            files.push({kind: 'world', name: file.name});
          } else files.push({kind: 'json', value: JSON.parse(await file.text())});
        } catch (error) { files.push({kind: 'error', message: error.message}); }
      };
      input.click();
    },
    download(plan) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = 'factory-plan.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async save(plan) {
      try {
        const db = await database;
        const transaction = db.transaction('plans', 'readwrite');
        transaction.objectStore('plans').put(plan, 'autosave');
        transaction.onerror = () => files.push({kind: 'error', message: 'Browser storage failed. Export your plan to keep a portable copy.'});
      } catch (error) { files.push({kind: 'error', message: `Browser storage is unavailable: ${error.message}`}); }
    },
    async restore() {
      try {
        const db = await database;
        const request = db.transaction('plans').objectStore('plans').get('autosave');
        request.onsuccess = () => { if (request.result) files.push({kind: 'json', value: request.result}); };
      } catch (error) { files.push({kind: 'error', message: `Browser storage is unavailable: ${error.message}`}); }
    },
  };
})();
