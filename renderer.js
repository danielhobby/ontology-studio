const state = { model: null, instances: [], selectedClass: null, editingId: null, expandedClasses: new Set(), shapes: [] };
const $ = selector => document.querySelector(selector);
const esc = value => String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

for (const button of [$('#import-button'), $('#empty-import')]) button.addEventListener('click', importOntology);
$('#import-instances-button').addEventListener('click', importExistingInstances);
$('#load-shacl-button').addEventListener('click', loadShaclShapes);
$('#class-search').addEventListener('input', renderClasses);
$('#validate-button').addEventListener('click', validateInstances);
$('#export-button').addEventListener('click', exportInstances);

async function importOntology() {
  try {
    const model = await window.ontologyAPI.openOntology();
    if (!model) return;
    state.model = model; state.instances = []; state.selectedClass = null; state.editingId = null; state.expandedClasses = new Set(); state.shapes = model.shapes || [];
    $('#empty-state').hidden = true; $('#workspace').hidden = false;
    $('#import-instances-button').hidden = false;
    $('#file-status').textContent = `${model.fileName} · ${model.classes.length} classes`;
    renderClasses(); renderInstances(); renderShapeStatus(); showWelcome();
  } catch (error) { alert(`Could not read this ontology.\n\n${error.message}`); }
}
async function loadShaclShapes() {
  try {
    const source = await window.ontologyAPI.openShapes();
    if (!source) return;
    if (!source.shapes.length) return alert(`No sh:NodeShape definitions were found in ${source.fileName}.`);
    const draft = captureFormDraft();
    state.shapes = source.shapes; renderShapeStatus(source.fileName);
    if (state.selectedClass) renderEditor(draft);
  } catch (error) { alert(`Could not load these SHACL shapes.\n\n${error.message}`); }
}
function captureFormDraft() {
  const form = $('#editor form');
  return form ? Object.fromEntries(new FormData(form).entries()) : null;
}
function renderShapeStatus(fileName = '') { const count = state.shapes.length; $('#shape-status').textContent = count ? `${count} shape${count === 1 ? '' : 's'}${fileName ? ` · ${fileName}` : ''}` : 'No SHACL shapes loaded'; }
async function importExistingInstances() {
  if (!state.model) return;
  if (state.instances.length && !confirm('Replace the current instances with the selected JSON-LD dataset?')) return;
  try {
    const imported = await window.ontologyAPI.openInstances(state.model.prefixes, state.model.classes.map(item => item.id));
    if (!imported) return;
    state.instances = imported.instances; state.editingId = null;
    renderInstances(); showWelcome();
    const skipped = imported.ignored ? ` ${imported.ignored} node${imported.ignored === 1 ? ' was' : 's were'} skipped because no matching ontology class was found.` : '';
    alert(`Imported ${imported.instances.length} instance${imported.instances.length === 1 ? '' : 's'} from ${imported.fileName}.${skipped}`);
  } catch (error) { alert(`Could not import this instance dataset.\n\n${error.message}`); }
}
function showWelcome() { state.editingId = null; $('#editor').hidden = true; $('#welcome').hidden = false; }
function renderClasses() {
  const query = $('#class-search').value.trim().toLowerCase(); const list = $('#class-list');
  const { roots, children, byId } = buildClassTree();
  const visible = query ? matchingBranches(query, byId, children) : null;
  const renderNode = (item, depth = 0, seen = new Set()) => {
    if (seen.has(item.id) || (visible && !visible.has(item.id))) return '';
    const nextSeen = new Set(seen); nextSeen.add(item.id);
    const descendants = (children.get(item.id) || []).filter(child => !visible || visible.has(child.id));
    const hasChildren = descendants.length > 0;
    const expanded = query || state.expandedClasses.has(item.id) || item.id === state.selectedClass?.id;
    const childMarkup = hasChildren && expanded ? descendants.map(child => renderNode(child, depth + 1, nextSeen)).join('') : '';
    return `<div class="class-tree-node" style="--tree-depth:${depth}"><div class="class-tree-row">${hasChildren ? `<button class="class-tree-toggle ${expanded ? 'expanded' : ''}" data-id="${esc(item.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${esc(item.label)}">›</button>` : '<span class="class-tree-spacer"></span>'}<button class="class-item ${state.selectedClass?.id === item.id ? 'active' : ''}" data-id="${esc(item.id)}"><span class="class-dot"></span><span>${esc(item.label)}</span></button></div>${childMarkup}</div>`;
  };
  const markup = roots.map(root => renderNode(root)).join('');
  list.innerHTML = markup || '<p class="muted">No classes found</p>';
  list.querySelectorAll('.class-item').forEach(button => button.addEventListener('click', () => { state.editingId = null; selectClass(button.dataset.id); }));
  list.querySelectorAll('.class-tree-toggle').forEach(button => button.addEventListener('click', () => { const id = button.dataset.id; state.expandedClasses.has(id) ? state.expandedClasses.delete(id) : state.expandedClasses.add(id); renderClasses(); }));
}
function buildClassTree() {
  const byId = new Map(state.model.classes.map(item => [item.id, item])); const children = new Map(); const roots = [];
  state.model.classes.forEach(item => { if (item.parent && byId.has(item.parent) && item.parent !== item.id) { if (!children.has(item.parent)) children.set(item.parent, []); children.get(item.parent).push(item); } else roots.push(item); });
  const byLabel = (a, b) => a.label.localeCompare(b.label); roots.sort(byLabel); children.forEach(items => items.sort(byLabel));
  return { roots, children, byId };
}
function matchingBranches(query, byId, children) {
  const visible = new Set();
  const includeDescendants = item => { visible.add(item.id); (children.get(item.id) || []).forEach(includeDescendants); };
  byId.forEach(item => { if (item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)) { includeDescendants(item); let parent = item.parent; const lineage = new Set(); while (parent && byId.has(parent) && !lineage.has(parent)) { visible.add(parent); lineage.add(parent); parent = byId.get(parent).parent; } } });
  return visible;
}
function selectClass(id) { state.selectedClass = state.model.classes.find(item => item.id === id); let parent = state.selectedClass?.parent; const byId = new Map(state.model.classes.map(item => [item.id, item])); while (parent && byId.has(parent)) { state.expandedClasses.add(parent); parent = byId.get(parent).parent; } renderClasses(); renderEditor(); }
function activeShapeRules(classId) {
  const applicableTypes = new Set([classId]); const byId = new Map(state.model.classes.map(item => [item.id, item])); let parent = byId.get(classId)?.parent;
  while (parent && byId.has(parent) && !applicableTypes.has(parent)) { applicableTypes.add(parent); parent = byId.get(parent).parent; }
  return state.shapes.filter(shape => applicableTypes.has(shape.targetClass)).flatMap(shape => shape.propertyShapes || []);
}
function validateShaclControl(control) {
  const rules = activeShapeRules(state.selectedClass.id).filter(rule => rule.path === control.dataset.shaclPath);
  const value = control.value.trim(); const messages = [];
  const ontologyRange = control.dataset.range;
  if (value && ontologyRange) {
    if (control.dataset.object === 'true') {
      const target = state.instances.find(instance => instance['@id'] === value);
      if (!target || !isInstanceOfClass(target['@type'], ontologyRange)) messages.push(`Select an instance of ${classLabel(ontologyRange)} or one of its subclasses.`);
    } else if (!matchesShaclDatatype(value, ontologyRange)) messages.push(`Enter a valid ${localName(ontologyRange)} value.`);
  }
  rules.forEach(rule => {
    if (rule.minCount > 0 && !value) messages.push(rule.message || 'This field is required.');
    if (value && rule.datatype && !matchesShaclDatatype(value, rule.datatype)) messages.push(rule.message || `Enter a valid ${localName(rule.datatype)} value.`);
    if (value && rule.minInclusive !== null && Number(value) < rule.minInclusive) messages.push(rule.message || `Enter a value greater than or equal to ${rule.minInclusive}.`);
    if (value && rule.maxInclusive !== null && Number(value) > rule.maxInclusive) messages.push(rule.message || `Enter a value less than or equal to ${rule.maxInclusive}.`);
    if (value && rule.class) { const target = state.instances.find(instance => instance['@id'] === value); if (!target || !isInstanceOfClass(target['@type'], rule.class)) messages.push(rule.message || `Select an instance of ${classLabel(rule.class)} or one of its subclasses.`); }
  });
  const error = control.closest('label').querySelector('.field-error'); error.textContent = [...new Set(messages)].join(' '); error.hidden = messages.length === 0;
  control.classList.toggle('invalid', messages.length > 0); return messages.length === 0;
}
function validateShaclForm(form) { return [...form.querySelectorAll('[data-shacl-path]')].map(validateShaclControl).every(Boolean); }
function matchesShaclDatatype(value, datatype) {
  if (datatype.endsWith('#integer') || datatype.endsWith('#int') || datatype.endsWith('#long')) return /^[-+]?\d+$/.test(value);
  if (datatype.endsWith('#decimal') || datatype.endsWith('#double') || datatype.endsWith('#float')) return Number.isFinite(Number(value));
  if (datatype.endsWith('#boolean')) return ['true', 'false'].includes(value.toLowerCase());
  if (datatype.endsWith('#date')) return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (datatype.endsWith('#dateTime')) return !Number.isNaN(Date.parse(value));
  return true;
}
function isInstanceOfClass(actualClass, expectedClass) {
  const byId = new Map(state.model.classes.map(item => [item.id, item]));
  const seen = new Set(); let current = actualClass;
  while (current && !seen.has(current)) {
    if (current === expectedClass) return true;
    seen.add(current); current = byId.get(current)?.parent;
  }
  return false;
}
function classProperties(classId) {
  const domains = new Set([classId]); let changed = true;
  while (changed) { changed = false; state.model.classes.forEach(c => { if (domains.has(c.id) && c.parent && !domains.has(c.parent)) { domains.add(c.parent); changed = true; } }); }
  return state.model.properties.filter(p => !p.domain || domains.has(p.domain));
}
function renderEditor(draft = null) {
  const cls = state.selectedClass; const existing = state.instances.find(i => i['@id'] === state.editingId);
  $('#welcome').hidden = true; const editor = $('#editor'); editor.hidden = false; editor.innerHTML = '';
  const fragment = $('#editor-template').content.cloneNode(true);
  fragment.querySelector('.eyebrow').textContent = existing ? 'EDIT INSTANCE' : 'NEW INSTANCE';
  fragment.querySelector('h1').textContent = `${existing ? 'Edit' : 'Create'} ${cls.label}`;
  fragment.querySelector('[type=submit]').textContent = existing ? 'Save changes' : 'Create instance';
  fragment.querySelector('.class-description').textContent = cls.comment || `${existing ? 'Update' : 'Create'} an instance of ${cls.label}.`;
  const name = fragment.querySelector('[name=_instanceLabel]'); const id = fragment.querySelector('[name=_instanceId]');
  if (existing) { name.value = existing['rdfs:label'] || ''; id.value = existing['@id']; }
  else if (draft) { name.value = draft._instanceLabel || ''; id.value = draft._instanceId || ''; }
  const objectFields = fragment.querySelector('.object-property-fields'); const dataFields = fragment.querySelector('.data-property-fields'); const properties = classProperties(cls.id); const rules = activeShapeRules(cls.id);
  const objectProperties = []; const dataProperties = [];
  properties.forEach(property => (property.kind === 'object' || state.model.classes.some(c => c.id === property.range) ? objectProperties : dataProperties).push(property));
  fragment.querySelector('.object-properties-section').hidden = objectProperties.length === 0;
  fragment.querySelector('.data-properties-section').hidden = dataProperties.length === 0;
  properties.forEach(property => {
    const field = document.createElement('label'); const rangeName = property.range ? localName(property.range) : '';
    const object = property.kind === 'object' || state.model.classes.some(c => c.id === property.range);
    const propertyRules = rules.filter(rule => rule.path === property.id); const required = propertyRules.some(rule => rule.minCount > 0);
    const control = object ? objectInput(property, existing, draft) : dataInput(property);
    const validationAttributes = ` data-shacl-path="${esc(property.id)}" data-range="${esc(property.range)}" data-object="${object}"`;
    field.innerHTML = `<span>${esc(property.label)}${required ? ' <b class="required-indicator" title="Required by SHACL">*</b>' : ''} ${rangeName ? `<small>${esc(rangeName)}</small>` : ''}</span>${control.replace(/^(<\w+)/, '$1' + validationAttributes)}${property.comment ? `<em>${esc(property.comment)}</em>` : ''}<span class="field-error" hidden></span>`;
    (object ? objectFields : dataFields).appendChild(field);
    const savedValue = draft?.[property.id] ?? existing?.[property.id];
    if (!object && savedValue !== undefined) field.querySelector('input').value = savedValue;
  });
  fragment.querySelector('.no-properties').hidden = properties.length > 0;
  fragment.querySelectorAll('.cancel').forEach(button => button.addEventListener('click', showWelcome));
  const form = fragment.querySelector('form');
  form.querySelectorAll('[data-shacl-path]').forEach(control => ['input', 'change', 'blur'].forEach(event => control.addEventListener(event, () => validateShaclControl(control))));
  form.addEventListener('submit', saveInstance); editor.appendChild(fragment);
}
function objectInput(property, existing, draft) {
  const target = state.model.classes.find(c => c.id === property.range);
  const candidates = target ? state.instances.filter(i => isInstanceOfClass(i['@type'], target.id)) : state.instances;
  const selected = (draft?.[property.id] ?? existing?.[property.id]?.['@id']) || '';
  return `<select name="${esc(property.id)}"><option value="">Choose an existing instance</option>${candidates.map(i => `<option value="${esc(i['@id'])}" ${i['@id'] === selected ? 'selected' : ''}>${esc(i['rdfs:label'] || i['@id'])}</option>`).join('')}</select>`;
}
function dataInput(property) {
  const range = property.range || ''; const numeric = /#(integer|int|long|decimal|double|float)$/.test(range);
  const type = numeric ? 'number' : range.endsWith('#boolean') ? 'text' : 'text';
  const step = /#(integer|int|long)$/.test(range) ? ' step="1"' : numeric ? ' step="any"' : '';
  return `<input name="${esc(property.id)}" type="${type}"${step} placeholder="${property.comment ? esc(property.comment) : 'Enter a value'}"/>`;
}
function saveInstance(event) {
  event.preventDefault(); if (!validateShaclForm(event.currentTarget)) return; const data = new FormData(event.currentTarget); const label = data.get('_instanceLabel').trim();
  const prior = state.instances.find(i => i['@id'] === state.editingId);
  const id = data.get('_instanceId').trim() || prior?.['@id'] || `urn:instance:${slug(label)}-${Date.now().toString(36)}`;
  const instance = { ...(prior || {}), '@id': id, '@type': state.selectedClass.id, 'rdfs:label': label };
  classProperties(state.selectedClass.id).forEach(property => delete instance[property.id]);
  for (const [key, value] of data.entries()) if (!['_instanceLabel', '_instanceId'].includes(key) && value) instance[key] = value.startsWith('urn:') || value.startsWith('http') ? { '@id': value } : value;
  const index = state.instances.findIndex(i => i['@id'] === state.editingId);
  if (index >= 0) state.instances[index] = instance; else state.instances.push(instance);
  state.editingId = id; renderInstances(); renderEditor();
}
function renderInstances() {
  $('#instance-count').textContent = state.instances.length;
  const grouped = new Map();
  state.instances.forEach(instance => {
    const type = instance['@type'];
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(instance);
  });
  const groups = [...grouped.entries()].sort(([a], [b]) => classLabel(a).localeCompare(classLabel(b)));
  $('#instance-list').innerHTML = groups.length ? groups.map(([type, instances]) => `<details class="instance-group" open><summary><span class="tree-caret">›</span><span class="tree-class">${esc(classLabel(type))}</span><span class="tree-count">${instances.length}</span></summary><div class="tree-children">${instances.sort((a, b) => String(a['rdfs:label']).localeCompare(String(b['rdfs:label']))).map(i => `<button class="instance ${i['@id'] === state.editingId ? 'active' : ''}" data-id="${esc(i['@id'])}"><span class="tree-branch">└</span><strong>${esc(i['rdfs:label'] || localName(i['@id']))}</strong></button>`).join('')}</div></details>`).join('') : '<p class="muted">Nothing created yet</p>';
  $('#instance-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => editInstance(button.dataset.id)));
}
function editInstance(id) { const instance = state.instances.find(item => item['@id'] === id); state.editingId = id; state.selectedClass = state.model.classes.find(c => c.id === instance['@type']); renderClasses(); renderInstances(); renderEditor(); }
async function validateInstances() {
  if (!state.instances.length) return alert('Create at least one instance before validating.');
  const report = await window.ontologyAPI.validateInstances(state.instances, { ...state.model, shapes: state.shapes }); const panel = $('#validation-results'); panel.hidden = false;
  if (!report.shapesChecked) panel.innerHTML = '<div class="validation notice"><strong>No SHACL shapes found.</strong><span>Import an ontology containing sh:NodeShape definitions to run SHACL validation.</span></div>';
  else if (report.conforms) panel.innerHTML = `<div class="validation success"><strong>Validation passed</strong><span>${state.instances.length} instance${state.instances.length === 1 ? '' : 's'} conform to ${report.shapesChecked} SHACL shape${report.shapesChecked === 1 ? '' : 's'}.</span></div>`;
  else panel.innerHTML = `<div class="validation error"><strong>${report.results.length} validation issue${report.results.length === 1 ? '' : 's'}</strong><ul>${report.results.map(item => `<li><b>${esc(item.focusLabel)}</b> · ${esc(item.message)}</li>`).join('')}</ul></div>`;
}
async function exportInstances() { if (!state.instances.length) return alert('Create at least one instance before exporting.'); const ok = await window.ontologyAPI.saveInstances(state.instances, state.model.prefixes); if (ok) alert('Instances exported successfully.'); }
function localName(value) { const match = String(value || '').match(/[#/]([^#/]+)$/); return match ? match[1] : value; }
function classLabel(id) { return state.model.classes.find(item => item.id === id)?.label || localName(id); }
function slug(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'instance'; }
