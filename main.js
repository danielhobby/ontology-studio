const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { Parser } = require('n3');

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SH = 'http://www.w3.org/ns/shacl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

function makeWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#f7f8fc',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  window.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('ontology:open', openOntology);
  ipcMain.handle('instances:open', (_, prefixes, classIds) => openInstances(prefixes, classIds));
  ipcMain.handle('shacl:open', openShapes);
  ipcMain.handle('instances:save', saveInstances);
  ipcMain.handle('shacl:validate', (_, instances, model) => validateInstances(instances, model));
  makeWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function openOntology() {
  const result = await dialog.showOpenDialog({
    title: 'Open an ontology',
    filters: [{ name: 'Ontologies', extensions: ['ttl', 'turtle', 'jsonld', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, 'utf8');
  const source = /\.ttl|\.turtle$/i.test(filePath) ? turtleToModel(text) : jsonLdToModel(JSON.parse(text));
  return { ...source, fileName: path.basename(filePath), filePath };
}

async function saveInstances(_, instances, context) {
  const result = await dialog.showSaveDialog({
    title: 'Export instances as JSON-LD',
    defaultPath: 'ontology-instances.jsonld',
    filters: [{ name: 'JSON-LD', extensions: ['jsonld', 'json'] }]
  });
  if (result.canceled) return false;
  await fs.writeFile(result.filePath, JSON.stringify({ '@context': context || {}, '@graph': instances }, null, 2));
  return true;
}

async function openInstances(ontologyPrefixes = {}, classIds = []) {
  const result = await dialog.showOpenDialog({
    title: 'Import JSON-LD instances',
    filters: [{ name: 'JSON-LD', extensions: ['jsonld', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const imported = jsonLdToInstances(document, ontologyPrefixes, new Set(classIds));
  return { ...imported, fileName: path.basename(filePath) };
}

async function openShapes() {
  const result = await dialog.showOpenDialog({
    title: 'Load SHACL shapes',
    filters: [{ name: 'SHACL shapes', extensions: ['ttl', 'turtle', 'jsonld', 'json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0]; const text = await fs.readFile(filePath, 'utf8');
  const source = /\.ttl|\.turtle$/i.test(filePath) ? turtleToModel(text) : jsonLdToModel(JSON.parse(text));
  return { shapes: source.shapes, fileName: path.basename(filePath) };
}

function jsonLdToInstances(document, ontologyPrefixes, classIds) {
  const context = document?.['@context'];
  const localPrefixes = context && typeof context === 'object'
    ? Object.fromEntries(Object.entries(context).filter(([, value]) => typeof value === 'string')) : {};
  const prefixes = { ...ontologyPrefixes, ...localPrefixes, rdf: RDF, rdfs: RDFS, owl: OWL };
  const vocab = typeof context === 'object' ? context['@vocab'] : '';
  const expand = value => {
    if (!value || typeof value !== 'string' || value.startsWith('http:') || value.startsWith('https:') || value.startsWith('urn:') || value.startsWith('_:')) return value;
    if (prefixes[value]) return prefixes[value];
    const [prefix, rest] = value.split(':');
    if (rest !== undefined && prefixes[prefix]) return prefixes[prefix] + rest;
    return vocab && !value.includes(':') ? vocab + value : value;
  };
  const nodes = Array.isArray(document) ? document : (document?.['@graph'] || [document]);
  const instances = []; let ignored = 0;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const id = expand(node['@id'] || node.id || '');
    const rawTypes = node['@type'] || node.type || []; const types = (Array.isArray(rawTypes) ? rawTypes : [rawTypes]).map(expand);
    const type = types.find(item => classIds.has(item));
    if (!id || !type) { ignored++; continue; }
    const instance = { '@id': id, '@type': type };
    for (const [rawKey, rawValue] of Object.entries(node)) {
      if (rawKey === '@id' || rawKey === 'id' || rawKey === '@type' || rawKey === 'type' || rawKey === '@context') continue;
      const key = expand(rawKey);
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const normalize = value => {
        if (!value || typeof value !== 'object') return value;
        if ('@id' in value) return { '@id': expand(value['@id']) };
        if ('@value' in value) return value['@value'];
        return value;
      };
      const normalized = values.map(normalize);
      const targetKey = key === RDFS + 'label' || rawKey === 'rdfs:label' ? 'rdfs:label' : key;
      instance[targetKey] = Array.isArray(rawValue) ? normalized : normalized[0];
    }
    if (!instance['rdfs:label']) instance['rdfs:label'] = short(id, prefixes);
    instances.push(instance);
  }
  return { instances, ignored };
}

function emptyModel(prefixes = {}) { return { prefixes, classes: [], properties: [], shapes: [] }; }
function short(uri, prefixes = {}) {
  if (!uri) return '';
  for (const [prefix, base] of Object.entries(prefixes)) if (uri.startsWith(base)) return `${prefix}:${uri.slice(base.length)}`;
  const match = uri.match(/[#/]([^#/]+)$/); return match ? match[1] : uri;
}
function addUnique(items, item) { if (!items.some(x => x.id === item.id)) items.push(item); }
function turtleToModel(text) {
  const parser = new Parser(); const quads = parser.parse(text);
  const prefixes = parser._prefixes || {};
  const model = emptyModel(prefixes); const classIds = new Set(); const propertyIds = new Set();
  const values = new Map();
  for (const q of quads) {
    const subject = q.subject.value, predicate = q.predicate.value, object = q.object.value;
    if (!values.has(subject)) values.set(subject, {});
    (values.get(subject)[predicate] ||= []).push({ value: object, termType: q.object.termType });
    if (predicate === RDF + 'type' && (object === OWL + 'Class' || object === RDFS + 'Class')) classIds.add(subject);
    if (predicate === RDF + 'type' && [OWL + 'ObjectProperty', OWL + 'DatatypeProperty', OWL + 'AnnotationProperty', RDF + 'Property'].includes(object)) propertyIds.add(subject);
  }
  for (const [id, facts] of values) {
    const type = facts[RDF + 'type']?.map(x => x.value) || [];
    if (type.includes(OWL + 'Class') || type.includes(RDFS + 'Class')) classIds.add(id);
    if (facts[RDFS + 'domain'] || facts[RDFS + 'range']) propertyIds.add(id);
  }
  for (const id of classIds) {
    const f = values.get(id) || {};
    addUnique(model.classes, { id, label: f[RDFS + 'label']?.[0]?.value || short(id, prefixes), comment: f[RDFS + 'comment']?.[0]?.value || '', parent: f[RDFS + 'subClassOf']?.[0]?.value || '' });
  }
  for (const id of propertyIds) {
    const f = values.get(id) || {}; const types = f[RDF + 'type']?.map(x => x.value) || [];
    addUnique(model.properties, { id, label: f[RDFS + 'label']?.[0]?.value || short(id, prefixes), comment: f[RDFS + 'comment']?.[0]?.value || '', domain: f[RDFS + 'domain']?.[0]?.value || '', range: f[RDFS + 'range']?.[0]?.value || '', kind: types.includes(OWL + 'ObjectProperty') ? 'object' : 'data' });
  }
  for (const [id, facts] of values) {
    const types = facts[RDF + 'type']?.map(x => x.value) || [];
    if (!types.includes(SH + 'NodeShape')) continue;
    const propertyShapes = (facts[SH + 'property'] || []).map(entry => {
      const p = values.get(entry.value) || {};
      return {
        path: p[SH + 'path']?.[0]?.value || '', minCount: Number(p[SH + 'minCount']?.[0]?.value || 0),
        maxCount: p[SH + 'maxCount'] ? Number(p[SH + 'maxCount'][0].value) : null,
        minInclusive: p[SH + 'minInclusive'] ? Number(p[SH + 'minInclusive'][0].value) : null,
        maxInclusive: p[SH + 'maxInclusive'] ? Number(p[SH + 'maxInclusive'][0].value) : null,
        class: p[SH + 'class']?.[0]?.value || '', datatype: p[SH + 'datatype']?.[0]?.value || '',
        nodeKind: p[SH + 'nodeKind']?.[0]?.value || '', message: p[SH + 'message']?.[0]?.value || ''
      };
    });
    model.shapes.push({ id, label: facts[RDFS + 'label']?.[0]?.value || short(id, prefixes), targetClass: facts[SH + 'targetClass']?.[0]?.value || '', propertyShapes });
  }
  return model;
}
function jsonLdToModel(document) {
  const prefixes = { ...(document['@context'] && typeof document['@context'] === 'object' ? Object.fromEntries(Object.entries(document['@context']).filter(([,v]) => typeof v === 'string')) : {}) };
  const model = emptyModel(prefixes); const nodes = Array.isArray(document) ? document : (document['@graph'] || [document]);
  const expand = value => {
    if (!value || typeof value !== 'string' || value.startsWith('http')) return value;
    const [p, rest] = value.split(':'); return rest !== undefined && prefixes[p] ? prefixes[p] + rest : value;
  };
  const nodeId = n => expand(n['@id'] || n.id || '');
  const nodeMap = new Map(nodes.filter(n => n && typeof n === 'object').map(n => [nodeId(n), n]));
  const getValues = (node, key) => {
    const value = node[key] ?? node[short(key, prefixes)];
    return value === undefined ? [] : (Array.isArray(value) ? value : [value]);
  };
  const valueOf = value => typeof value === 'object' ? expand(value?.['@id'] || value?.['@value']) : expand(value);
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const id = nodeId(n); const rawTypes = n['@type'] || n.type || []; const types = (Array.isArray(rawTypes) ? rawTypes : [rawTypes]).map(expand);
    const get = (...keys) => { const value = keys.flatMap(k => n[k] || n[short(k, prefixes)] || []); const first = Array.isArray(value) ? value[0] : value; return typeof first === 'object' ? expand(first?.['@id'] || first?.['@value']) : first; };
    const label = get(RDFS + 'label', 'label') || short(id, prefixes);
    const comment = get(RDFS + 'comment', 'comment') || '';
    if (types.includes(OWL + 'Class') || types.includes(RDFS + 'Class')) addUnique(model.classes, { id, label, comment, parent: expand(get(RDFS + 'subClassOf', 'subClassOf') || '') });
    if (types.some(t => [OWL + 'ObjectProperty', OWL + 'DatatypeProperty', OWL + 'AnnotationProperty', RDF + 'Property'].includes(t)) || get(RDFS + 'domain', 'domain')) addUnique(model.properties, { id, label, comment, domain: expand(get(RDFS + 'domain', 'domain') || ''), range: expand(get(RDFS + 'range', 'range') || ''), kind: types.includes(OWL + 'ObjectProperty') ? 'object' : 'data' });
    if (types.includes(SH + 'NodeShape')) {
      const propertyShapes = getValues(n, SH + 'property').map(value => value?.['@id'] ? nodeMap.get(valueOf(value)) : value).filter(Boolean).map(propertyNode => ({
        path: valueOf(getValues(propertyNode, SH + 'path')[0]) || '',
        minCount: Number(valueOf(getValues(propertyNode, SH + 'minCount')[0]) || 0),
        maxCount: getValues(propertyNode, SH + 'maxCount').length ? Number(valueOf(getValues(propertyNode, SH + 'maxCount')[0])) : null,
        minInclusive: getValues(propertyNode, SH + 'minInclusive').length ? Number(valueOf(getValues(propertyNode, SH + 'minInclusive')[0])) : null,
        maxInclusive: getValues(propertyNode, SH + 'maxInclusive').length ? Number(valueOf(getValues(propertyNode, SH + 'maxInclusive')[0])) : null,
        class: valueOf(getValues(propertyNode, SH + 'class')[0]) || '', datatype: valueOf(getValues(propertyNode, SH + 'datatype')[0]) || '',
        nodeKind: valueOf(getValues(propertyNode, SH + 'nodeKind')[0]) || '', message: valueOf(getValues(propertyNode, SH + 'message')[0]) || ''
      }));
      model.shapes.push({ id, label, targetClass: valueOf(getValues(n, SH + 'targetClass')[0]) || '', propertyShapes });
    }
  }
  return model;
}

function validateInstances(instances, model) {
  const results = [];
  const byId = new Map(instances.map(instance => [instance['@id'], instance]));
  for (const shape of model.shapes || []) {
    for (const instance of instances.filter(item => item['@type'] === shape.targetClass)) {
      for (const rule of shape.propertyShapes) {
        const raw = instance[rule.path]; const values = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]);
        const subject = instance['rdfs:label'] || instance['@id']; const property = short(rule.path, model.prefixes);
        const add = message => results.push({ focusNode: instance['@id'], focusLabel: subject, path: rule.path, property, message: rule.message || message });
        if (values.length < rule.minCount) add(`${property} requires at least ${rule.minCount} value${rule.minCount === 1 ? '' : 's'}.`);
        if (rule.maxCount !== null && values.length > rule.maxCount) add(`${property} allows at most ${rule.maxCount} value${rule.maxCount === 1 ? '' : 's'}.`);
        for (const value of values) {
          const reference = value && typeof value === 'object' ? value['@id'] : null;
          if (rule.nodeKind.endsWith('IRI') && !reference) add(`${property} must be an IRI reference.`);
          if (rule.class) {
            const target = reference && byId.get(reference);
            if (!target || !isClassOrSubclass(target['@type'], rule.class, model)) add(`${property} must reference an instance of ${short(rule.class, model.prefixes)} or one of its subclasses.`);
          }
          if (rule.datatype && !matchesDatatype(value, rule.datatype)) add(`${property} must have datatype ${short(rule.datatype, model.prefixes)}.`);
          if (rule.minInclusive !== null && Number(value) < rule.minInclusive) add(`${property} must be greater than or equal to ${rule.minInclusive}.`);
          if (rule.maxInclusive !== null && Number(value) > rule.maxInclusive) add(`${property} must be less than or equal to ${rule.maxInclusive}.`);
        }
      }
    }
  }
  return { conforms: results.length === 0, results, shapesChecked: (model.shapes || []).length };
}
function matchesDatatype(value, datatype) {
  if (value && typeof value === 'object') return false;
  if (datatype === XSD + 'string') return typeof value === 'string';
  if ([XSD + 'integer', XSD + 'int', XSD + 'long'].includes(datatype)) return /^[-+]?\d+$/.test(String(value));
  if ([XSD + 'decimal', XSD + 'double', XSD + 'float'].includes(datatype)) return Number.isFinite(Number(value));
  if (datatype === XSD + 'boolean') return ['true', 'false', true, false].includes(value);
  if (datatype === XSD + 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (datatype === XSD + 'dateTime') return !Number.isNaN(Date.parse(String(value)));
  return true;
}
function isClassOrSubclass(actualClass, expectedClass, model) {
  const byId = new Map((model.classes || []).map(item => [item.id, item]));
  const seen = new Set(); let current = actualClass;
  while (current && !seen.has(current)) {
    if (current === expectedClass) return true;
    seen.add(current); current = byId.get(current)?.parent;
  }
  return false;
}
