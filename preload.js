const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ontologyAPI', {
  openOntology: () => ipcRenderer.invoke('ontology:open'),
  openInstances: (prefixes, classIds) => ipcRenderer.invoke('instances:open', prefixes, classIds),
  openShapes: () => ipcRenderer.invoke('shacl:open'),
  saveInstances: (instances, context) => ipcRenderer.invoke('instances:save', instances, context),
  validateInstances: (instances, model) => ipcRenderer.invoke('shacl:validate', instances, model)
});
