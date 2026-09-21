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
    async save(plan, dataset) {
      try {
        const db = await database;
        const transaction = db.transaction('plans', 'readwrite');
        if (dataset) transaction.objectStore('plans').put(dataset, `dataset:${plan.dataset_ref}`);
        else if (plan.dataset_ref) {
          const cached = transaction.objectStore('plans').get(`dataset:${plan.dataset_ref}`);
          cached.onsuccess = () => { if (!cached.result) transaction.abort(); };
        }
        transaction.objectStore('plans').put(plan, 'autosave');
        if (plan.view) transaction.objectStore('plans').put({dataset_identity: plan.dataset_identity, view: plan.view}, 'workspace-view');
        else transaction.objectStore('plans').delete('workspace-view');
        transaction.onabort = () => files.push({kind: 'error', message: 'Browser storage could not retain this plan and its dataset. Export a portable copy.'});
      } catch (error) { files.push({kind: 'error', message: `Browser storage is unavailable: ${error.message}`}); }
    },
    async saveView(record) {
      try {
        const db = await database;
        const transaction = db.transaction('plans', 'readwrite');
        transaction.objectStore('plans').put(record, 'workspace-view');
        transaction.onerror = () => files.push({kind: 'error', message: 'Browser storage could not save the workspace view.'});
      } catch (error) { files.push({kind: 'error', message: `Browser storage is unavailable: ${error.message}`}); }
    },
    async restore() {
      try {
        const db = await database;
        const transaction = db.transaction('plans');
        const request = transaction.objectStore('plans').get('autosave');
        const view = transaction.objectStore('plans').get('workspace-view');
        transaction.oncomplete = () => {
          if (!request.result) return;
          if (view.result?.dataset_identity === request.result.dataset_identity) request.result.view = view.result.view;
          if (request.result.dataset) { files.push({kind: 'json', value: request.result}); return; }
          const cached = db.transaction('plans').objectStore('plans').get(`dataset:${request.result.dataset_ref}`);
          cached.onsuccess = () => {
            if (!cached.result) { files.push({kind: 'error', message: 'The saved dataset is missing. Import a portable plan to recover.'}); return; }
            files.push({kind: 'json', value: {...request.result, dataset: cached.result}});
          };
          cached.onerror = () => files.push({kind: 'error', message: 'Browser storage could not read the saved dataset.'});
        };
        transaction.onerror = () => files.push({kind: 'error', message: 'Browser storage could not restore the saved plan.'});
      } catch (error) { files.push({kind: 'error', message: `Browser storage is unavailable: ${error.message}`}); }
    },
  };
})();
