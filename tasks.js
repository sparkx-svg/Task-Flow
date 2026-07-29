import {
  addDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db, tasksCol, reportError } from './firebase.js';
import { state, UNDO_DELETE_MS } from './state.js';
import { renderTasks, showToast, dismissToast } from './ui.js';
import { getCurrentList, writePresence } from './sharing.js';

export function subscribeToTasks(){
  if(state.unsubscribeTasks) state.unsubscribeTasks();
  // Show a skeleton placeholder until the first snapshot arrives
  document.getElementById('taskList').innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  const isPersonal = state.currentListId === state.currentUser.uid;
  // Personal view: fall back to the legacy userId-only query so tasks created
  // before shared lists existed (no listId field) still show up; shared-list
  // tasks the same user authored are filtered out client-side below.
  // Shared view: query the list's tasks directly so every member sees them.
  // limit keeps reads (and render cost) bounded as task counts grow —
  // "Load more" below just raises the limit and re-subscribes.
  // Note: no orderBy here on purpose — combining it with the where() above
  // requires a Firestore composite index. We sort by 'order' client-side
  // instead (below) so this works without any index setup.
  const q = isPersonal
    ? query(tasksCol, where('userId', '==', state.currentUser.uid), limit(state.pageSize))
    : query(tasksCol, where('listId', '==', state.currentListId), limit(state.pageSize));
  // includeMetadataChanges:true lets us render local (pending) writes instantly —
  // this is what gives add/toggle/delete their "optimistic" feel — and then
  // re-render silently once the server confirms.
  state.unsubscribeTasks = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(isPersonal) tasks = tasks.filter(t => !t.listId || t.listId === state.currentUser.uid);
    tasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    state.tasksCache = tasks;
    state.lastSnapCount = snap.docs.length;
    renderTasks();
    checkDueReminders();
    const loadMoreRow = document.getElementById('loadMoreRow');
    loadMoreRow.classList.toggle('hidden', state.lastSnapCount < state.pageSize);
  }, (err) => {
    reportError('Task sync error:', err);
    const list = document.getElementById('taskList');
    list.innerHTML = `<div class="empty-state">Couldn't load tasks: ${err.message || err.code || 'unknown error'}</div>`;
  });
}

export function loadMoreTasks(){
  state.pageSize += 50;
  const btn = document.getElementById('loadMoreBtn');
  btn.textContent = 'Loading…';
  btn.disabled = true;
  subscribeToTasks();
  setTimeout(() => { btn.textContent = 'Load more tasks'; btn.disabled = false; }, 600);
}

export function getTask(id){
  return state.tasksCache.find(t => t.id === id);
}

// ---- Filter / sort — pure logic, good unit-test candidates ----
export function filterTasks(tasks){
  return tasks.filter(t => {
    if(state.filterStatusVal === 'pending' && t.status === 'done') return false;
    if(state.filterStatusVal === 'done' && t.status !== 'done') return false;
    if(state.filterPriorityVal !== 'all' && t.priority !== state.filterPriorityVal) return false;
    if(state.filterTagVal !== 'all' && !(t.tags || []).includes(state.filterTagVal)) return false;
    if(state.searchQueryVal && !t.title.toLowerCase().includes(state.searchQueryVal.toLowerCase())) return false;
    return true;
  });
}

export function updateTagFilterOptions(){
  const select = document.getElementById('filterTag');
  const allTags = new Set();
  state.tasksCache.forEach(t => (t.tags || []).forEach(tag => allTags.add(tag)));
  const sorted = Array.from(allTags).sort((a, b) => a.localeCompare(b));
  const current = select.value;
  select.innerHTML = '<option value="all">All tags</option>' +
    sorted.map(tag => `<option value="${tag}">${tag}</option>`).join('');
  // Keep the current selection if it's still a valid tag; otherwise fall back to "all"
  if(sorted.includes(current)){
    select.value = current;
  }else{
    state.filterTagVal = 'all';
  }
}

export function sortTasks(tasks){
  const arr = [...tasks];
  if(state.currentSort === 'dueDate'){
    arr.sort((a, b) => {
      if(!a.dueDate && !b.dueDate) return 0;
      if(!a.dueDate) return 1;
      if(!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }else if(state.currentSort === 'priority'){
    const rank = { high: 0, medium: 1, low: 2 };
    arr.sort((a, b) => rank[a.priority] - rank[b.priority]);
  }else if(state.currentSort === 'newest'){
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }else{ // custom
    arr.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  }
  return arr;
}

export function isDragEnabled(){
  return state.currentSort === 'custom' && state.filterStatusVal === 'all' && state.filterPriorityVal === 'all' && state.filterTagVal === 'all' && !state.searchQueryVal;
}

export function updateDragHint(){
  const hint = document.getElementById('dragHint');
  if(state.currentSort !== 'custom'){
    hint.textContent = `Switch sort to "Custom order" to drag-and-drop tasks.`;
  }else if(!isDragEnabled()){
    hint.textContent = `Clear search/filters to drag-and-drop tasks.`;
  }else{
    hint.textContent = `Drag tasks by the ⠿ handle to reorder.`;
  }
}

export function formatDueDate(dueDate){
  // dueDate is 'YYYY-MM-DD'; build a local Date to avoid timezone shift
  const [y, m, d] = dueDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function isOverdue(t){
  if(!t.dueDate || t.status === 'done') return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return t.dueDate < todayStr;
}

export function subtaskStats(t){
  const subtasks = t.subtasks || [];
  const total = subtasks.length;
  const done = subtasks.filter(s => s.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ---- Due-date reminders (browser Notification API) ----
export function remindersEnabled(){
  try{ return localStorage.getItem('taskflow-reminders') === 'on'; }catch(e){ return false; }
}
export function updateReminderBtn(){
  const btn = document.getElementById('reminderToggleBtn');
  if(!btn) return;
  const on = remindersEnabled() && Notification && Notification.permission === 'granted';
  btn.textContent = on ? '🔔' : '🔕';
  btn.title = on ? 'Reminders on — click to disable' : 'Enable due-date reminders';
  btn.style.opacity = on ? '1' : '.6';
}
export async function toggleReminders(){
  if(!('Notification' in window)){
    alert('This browser does not support notifications.');
    return;
  }
  if(remindersEnabled()){
    try{ localStorage.setItem('taskflow-reminders', 'off'); }catch(e){}
    stopReminderChecks();
    updateReminderBtn();
    return;
  }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted'){
    updateReminderBtn();
    return;
  }
  try{ localStorage.setItem('taskflow-reminders', 'on'); }catch(e){}
  updateReminderBtn();
  startReminderChecks();
}
export function startReminderChecks(){
  if(state.remindersInterval) return;
  checkDueReminders();
  state.remindersInterval = setInterval(checkDueReminders, 5 * 60 * 1000); // every 5 minutes
}
export function stopReminderChecks(){
  if(state.remindersInterval){ clearInterval(state.remindersInterval); state.remindersInterval = null; }
}
export function checkDueReminders(){
  if(!remindersEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
  state.tasksCache.forEach(t => {
    if(t.status === 'done' || !t.dueDate) return;
    if(state.notifiedToday.has(t.id)) return;
    const due = t.dueDate <= todayStr; // due today or overdue
    if(!due) return;
    state.notifiedToday.add(t.id);
    try{
      new Notification(t.dueDate < todayStr ? 'Overdue task' : 'Due today', {
        body: t.title,
        tag: `taskflow-${t.id}`
      });
    }catch(e){ /* some browsers restrict Notification outside a service worker context */ }
  });
}

// ---- Drag to reorder ----
export function dragTaskStart(e, id){
  state.draggedTaskId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.target.closest('.task-item').classList.add('dragging');
}

export function dragTaskOver(e, id){
  e.preventDefault();
  if(id === state.draggedTaskId) return;
  e.currentTarget.classList.add('drag-over');
}

export function dragTaskLeave(e, id){
  e.currentTarget.classList.remove('drag-over');
}

export async function dragTaskDrop(e, targetId){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(!state.draggedTaskId || state.draggedTaskId === targetId) return;

  const visible = sortTasks(filterTasks(state.tasksCache));
  const fromIdx = visible.findIndex(t => t.id === state.draggedTaskId);
  const toIdx = visible.findIndex(t => t.id === targetId);
  if(fromIdx === -1 || toIdx === -1) return;

  const reordered = [...visible];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  reordered.forEach((t, i) => { t.order = i; });

  // Optimistic: update local cache immediately, then persist
  state.tasksCache = state.tasksCache.map(t => {
    const updated = reordered.find(r => r.id === t.id);
    return updated ? { ...t, order: updated.order } : t;
  });
  state.draggedTaskId = null;
  renderTasks();

  try{
    const batch = writeBatch(db);
    reordered.forEach(t => batch.update(doc(db, 'tasks', t.id), { order: t.order }));
    await batch.commit();
  }catch(err){
    reportError('Failed to save order:', err);
    alert('Could not save the new order: ' + (err.message || err.code));
  }
}

export function dragTaskEnd(e){
  document.querySelectorAll('.task-item.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  state.draggedTaskId = null;
}

// ---- Edit task ----
export function startEditTask(id){
  state.editingTaskId = id;
  renderTasks();
}

export function cancelEditTask(){
  state.editingTaskId = null;
  renderTasks();
}

export async function saveEditTask(id){
  const input = document.getElementById(`editInput-${id}`);
  const prioritySelect = document.getElementById(`editPriority-${id}`);
  const dueDateInput = document.getElementById(`editDueDate-${id}`);
  const tagsInput = document.getElementById(`editTags-${id}`);
  const recurrenceSelect = document.getElementById(`editRecurrence-${id}`);
  const title = input.value.trim();
  if(!title){
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 400);
    return;
  }
  const tags = parseTagsInput(tagsInput.value);
  state.editingTaskId = null;
  try{
    await updateDoc(doc(db, 'tasks', id), {
      title,
      priority: prioritySelect.value,
      dueDate: dueDateInput.value || null,
      tags,
      recurrence: recurrenceSelect.value || null
    });
  }catch(err){
    reportError('Failed to save edit:', err);
    alert('Could not save changes: ' + (err.message || err.code));
  }
}

// Pure — good unit-test candidate.
export function parseTagsInput(raw){
  const seen = new Set();
  const tags = [];
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(tag => {
    const key = tag.toLowerCase();
    if(!seen.has(key)){ seen.add(key); tags.push(tag); }
  });
  return tags;
}

export function generateLocalId(){
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function addTask(){
  if(!state.currentUser || state.addingTask) return;
  const titleInput = document.getElementById('newTaskTitle');
  const title = titleInput.value.trim();
  if(!title){
    titleInput.classList.add('input-error');
    titleInput.placeholder = 'Type something first…';
    titleInput.focus();
    setTimeout(() => titleInput.classList.remove('input-error'), 400);
    return;
  }
  const priority = document.getElementById('newTaskPriority').value;
  const dueDateInput = document.getElementById('newTaskDueDate');
  const dueDate = dueDateInput.value || null;
  const tagsInput = document.getElementById('newTaskTags');
  const tags = parseTagsInput(tagsInput.value);
  const recurrenceSelect = document.getElementById('newTaskRecurrence');
  const recurrence = recurrenceSelect.value || null;
  const assigneeSelect = document.getElementById('newTaskAssignee');
  const assigneeEmail = (!assigneeSelect.classList.contains('hidden') && assigneeSelect.value) || null;
  const maxOrder = state.tasksCache.reduce((max, t) => Math.max(max, t.order ?? -1), -1);
  state.addingTask = true;
  try{
    // No manual reload needed — onSnapshot's local-cache write reflects
    // this immediately, then reconciles once the server confirms.
    await addDoc(tasksCol, {
      userId: state.currentUser.uid,
      listId: state.currentListId,
      assigneeEmail,
      title,
      priority,
      dueDate,
      tags,
      recurrence,
      subtasks: [],
      status: 'pending',
      createdAt: Date.now(),
      order: maxOrder + 1
    });
    titleInput.value = '';
    dueDateInput.value = '';
    tagsInput.value = '';
    recurrenceSelect.value = '';
    if(assigneeSelect) assigneeSelect.value = '';
    if(state.typingClearTimer){ clearTimeout(state.typingClearTimer); state.typingClearTimer = null; }
    writePresence({ typing: false });
  }catch(err){
    reportError('Failed to add task:', err);
    alert('Could not add task: ' + (err.message || err.code));
  }finally{
    state.addingTask = false;
  }
}

export async function reassignTask(id, email){
  try{
    await updateDoc(doc(db, 'tasks', id), { assigneeEmail: email || null });
  }catch(err){
    reportError('Failed to reassign task:', err);
    alert('Could not reassign task: ' + (err.message || err.code));
  }
}

export async function toggleTask(id, currentStatus){
  const newStatus = currentStatus === 'done' ? 'pending' : 'done';
  try{
    await updateDoc(doc(db, 'tasks', id), { status: newStatus });
    if(newStatus === 'done'){
      const task = getTask(id);
      if(task && task.recurrence){
        await spawnNextRecurrence(task);
      }
    }
  }catch(err){
    reportError('Failed to update task:', err);
    alert('Could not update task: ' + (err.message || err.code));
  }
}

// ---- Recurrence date math — pure logic, good unit-test candidates ----
export function addDaysToDateStr(dateStr, days){
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

// Calendar-month advance (handles variable month lengths, e.g. Jan 31 -> Feb 28).
export function addMonthsToDateStr(dateStr, months){
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const targetMonth = dt.getMonth() + months;
  dt.setDate(1); // avoid month-rollover surprises while changing the month
  dt.setMonth(targetMonth);
  const daysInTarget = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, daysInTarget));
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

export function advanceRecurrenceDate(dateStr, recurrence){
  if(recurrence === 'monthly') return addMonthsToDateStr(dateStr, 1);
  return addDaysToDateStr(dateStr, recurrence === 'weekly' ? 7 : 1);
}

async function spawnNextRecurrence(task){
  const todayStr = addDaysToDateStr(
    `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`, 0
  );
  const nextDue = task.dueDate ? advanceRecurrenceDate(task.dueDate, task.recurrence) : advanceRecurrenceDate(todayStr, task.recurrence);
  const maxOrder = state.tasksCache.reduce((max, t) => Math.max(max, t.order ?? -1), -1);
  try{
    await addDoc(tasksCol, {
      userId: state.currentUser.uid,
      listId: task.listId || state.currentUser.uid,
      assigneeEmail: task.assigneeEmail || null,
      title: task.title,
      priority: task.priority,
      dueDate: nextDue,
      tags: task.tags || [],
      recurrence: task.recurrence,
      subtasks: (task.subtasks || []).map(s => ({ ...s, done: false })),
      status: 'pending',
      createdAt: Date.now(),
      order: maxOrder + 1
    });
  }catch(err){
    reportError('Failed to create the next recurring task:', err);
  }
}

// ---- Delete / undo ----
export function deleteTask(id){
  const task = getTask(id);
  if(!task || state.pendingDeleteTimers.has(id)) return;
  state.selectedTaskIds.delete(id);
  state.expandedTasks.delete(id);
  const timer = setTimeout(() => finalizeDelete(id), UNDO_DELETE_MS);
  state.pendingDeleteTimers.set(id, timer);
  renderTasks();
  showToast(`"${task.title.length > 40 ? task.title.slice(0,40)+'…' : task.title}" deleted`, () => undoDeleteTask(id), id);
}

async function finalizeDelete(id){
  if(!state.pendingDeleteTimers.has(id)) return; // already undone
  state.pendingDeleteTimers.delete(id);
  try{
    await deleteDoc(doc(db, 'tasks', id));
  }catch(err){
    reportError('Failed to delete task:', err);
    alert('Could not delete task: ' + (err.message || err.code));
    renderTasks();
  }
}

export function undoDeleteTask(id){
  const timer = state.pendingDeleteTimers.get(id);
  if(timer){ clearTimeout(timer); state.pendingDeleteTimers.delete(id); }
  dismissToast(id);
  renderTasks();
}

// ---- Subtasks / checklist ----
export function toggleExpandTask(id){
  if(state.expandedTasks.has(id)) state.expandedTasks.delete(id);
  else state.expandedTasks.add(id);
  renderTasks();
}

export async function addSubtask(taskId){
  const input = document.getElementById(`subtaskInput-${taskId}`);
  const title = input.value.trim();
  if(!title){
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 400);
    return;
  }
  const task = getTask(taskId);
  const newSubtasks = [...(task?.subtasks || []), { id: generateLocalId(), title, done: false }];
  input.value = '';
  try{
    await updateDoc(doc(db, 'tasks', taskId), { subtasks: newSubtasks });
  }catch(err){
    reportError('Failed to add step:', err);
    alert('Could not add step: ' + (err.message || err.code));
  }
}

export async function toggleSubtask(taskId, subtaskId){
  const task = getTask(taskId);
  if(!task) return;
  const newSubtasks = (task.subtasks || []).map(s => s.id === subtaskId ? { ...s, done: !s.done } : s);
  try{
    await updateDoc(doc(db, 'tasks', taskId), { subtasks: newSubtasks });
  }catch(err){
    reportError('Failed to update step:', err);
    alert('Could not update step: ' + (err.message || err.code));
  }
}

export async function deleteSubtask(taskId, subtaskId){
  const task = getTask(taskId);
  if(!task) return;
  const newSubtasks = (task.subtasks || []).filter(s => s.id !== subtaskId);
  try{
    await updateDoc(doc(db, 'tasks', taskId), { subtasks: newSubtasks });
  }catch(err){
    reportError('Failed to delete step:', err);
    alert('Could not delete step: ' + (err.message || err.code));
  }
}

// ---- Bulk actions ----
export function toggleSelectTask(id, checked){
  if(checked) state.selectedTaskIds.add(id);
  else state.selectedTaskIds.delete(id);
  renderTasks();
}

export function toggleSelectAll(checked){
  const visible = sortTasks(filterTasks(state.tasksCache));
  if(checked){
    visible.forEach(t => state.selectedTaskIds.add(t.id));
  }else{
    visible.forEach(t => state.selectedTaskIds.delete(t.id));
  }
  renderTasks();
}

export function clearSelection(){
  state.selectedTaskIds.clear();
  renderTasks();
}

export async function bulkMarkDone(){ await bulkSetStatus('done'); }
export async function bulkMarkPending(){ await bulkSetStatus('pending'); }

async function bulkSetStatus(status){
  if(state.selectedTaskIds.size === 0) return;
  const ids = Array.from(state.selectedTaskIds);
  try{
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'tasks', id), { status }));
    await batch.commit();
    clearSelection();
  }catch(err){
    reportError('Bulk status update failed:', err);
    alert('Could not update selected tasks: ' + (err.message || err.code));
  }
}

export async function bulkSetPriority(priority){
  const select = document.getElementById('bulkPrioritySelect');
  if(!priority || state.selectedTaskIds.size === 0){ select.value = ''; return; }
  const ids = Array.from(state.selectedTaskIds);
  try{
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'tasks', id), { priority }));
    await batch.commit();
    clearSelection();
  }catch(err){
    reportError('Bulk priority update failed:', err);
    alert('Could not update selected tasks: ' + (err.message || err.code));
  }finally{
    select.value = '';
  }
}

export function bulkDelete(){
  if(state.selectedTaskIds.size === 0) return;
  const ids = Array.from(state.selectedTaskIds).filter(id => !state.pendingDeleteTimers.has(id));
  if(ids.length === 0) return;
  const bulkId = `bulk-${Date.now()}`;
  ids.forEach(id => {
    state.expandedTasks.delete(id);
    state.pendingDeleteTimers.set(id, setTimeout(() => finalizeDelete(id), UNDO_DELETE_MS));
  });
  clearSelection();
  renderTasks();
  showToast(`${ids.length} task${ids.length > 1 ? 's' : ''} deleted`, () => {
    ids.forEach(id => undoDeleteTask(id));
  }, bulkId);
}

// ---- Export — pure logic aside from the DOM download trigger ----
function exportableTasks(){
  return state.tasksCache.filter(t => !state.pendingDeleteTimers.has(t.id));
}
function downloadBlob(content, filename, type){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export function exportTasksJSON(){
  const data = exportableTasks().map(t => ({
    title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate || '',
    tags: t.tags || [], recurrence: t.recurrence || '', assigneeEmail: t.assigneeEmail || '',
    subtasks: t.subtasks || []
  }));
  downloadBlob(JSON.stringify(data, null, 2), 'taskflow-export.json', 'application/json');
}
export function csvEscape(val){
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function exportTasksCSV(){
  const rows = [['title','status','priority','dueDate','tags','recurrence','assigneeEmail']];
  exportableTasks().forEach(t => {
    rows.push([
      t.title, t.status, t.priority, t.dueDate || '',
      (t.tags || []).join(';'), t.recurrence || '', t.assigneeEmail || ''
    ]);
  });
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(csv, 'taskflow-export.csv', 'text/csv');
}

// ---- Import ----
// Minimal RFC4180-ish parser: handles quoted fields, escaped quotes, commas/newlines in
// quotes. Pure logic, no DOM — a strong first unit-test candidate.
export function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i], next = text[i+1];
    if(inQuotes){
      if(c === '"' && next === '"'){ field += '"'; i++; }
      else if(c === '"'){ inQuotes = false; }
      else field += c;
    }else{
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field = ''; }
      else if(c === '\n' || c === '\r'){
        if(c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if(row.some(f => f !== '')) rows.push(row);
        row = [];
      }else field += c;
    }
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows;
}
export async function handleImportFile(file){
  if(!file) return;
  const fileInput = document.getElementById('importFileInput');
  try{
    const text = await file.text();
    const rows = parseCSV(text);
    if(rows.length < 2){ alert('That CSV has no data rows to import.'); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const titleIdx = idx('title');
    if(titleIdx === -1){ alert('CSV needs at least a "title" column.'); return; }
    const dataRows = rows.slice(1).filter(r => (r[titleIdx] || '').trim());
    if(dataRows.length === 0){ alert('No valid rows with a title were found.'); return; }
    if(!confirm(`Import ${dataRows.length} task${dataRows.length > 1 ? 's' : ''} into "${getCurrentList()?.name || 'Personal'}"?`)) return;

    const maxOrder = state.tasksCache.reduce((max, t) => Math.max(max, t.order ?? -1), -1);
    const chunks = [];
    for(let i = 0; i < dataRows.length; i += 400) chunks.push(dataRows.slice(i, i + 400));
    let imported = 0;
    for(const chunk of chunks){
      const batch = writeBatch(db);
      chunk.forEach((r, i) => {
        const priority = ['low','medium','high'].includes((r[idx('priority')]||'').trim())
          ? r[idx('priority')].trim() : 'medium';
        const status = (r[idx('status')]||'').trim() === 'done' ? 'done' : 'pending';
        const tags = idx('tags') > -1 ? parseTagsInput((r[idx('tags')]||'').replace(/;/g, ',')) : [];
        const recurrence = ['daily','weekly','monthly'].includes((r[idx('recurrence')]||'').trim())
          ? r[idx('recurrence')].trim() : null;
        const dueDate = idx('duedate') > -1 && r[idx('duedate')].trim() ? r[idx('duedate')].trim() : null;
        const assigneeEmail = idx('assigneeemail') > -1 && r[idx('assigneeemail')].trim() ? r[idx('assigneeemail')].trim() : null;
        const ref = doc(tasksCol);
        batch.set(ref, {
          userId: state.currentUser.uid,
          listId: state.currentListId,
          assigneeEmail,
          title: r[titleIdx].trim(),
          priority, dueDate, tags, recurrence,
          subtasks: [],
          status,
          createdAt: Date.now(),
          order: maxOrder + 1 + imported + i
        });
      });
      await batch.commit();
      imported += chunk.length;
    }
  }catch(err){
    reportError('Import failed:', err);
    alert('Could not import CSV: ' + (err.message || err.code));
  }finally{
    fileInput.value = '';
  }
}

// Wires up filter/sort/search/new-task DOM listeners. Called once from main.js.
export function initTasks(){
  if(remindersEnabled()) startReminderChecks();

  document.getElementById('newTaskTitle').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') addTask();
  });

  document.getElementById('newTaskTitle').addEventListener('input', () => {
    if(!state.currentUser || state.currentListId === state.currentUser.uid) return; // only meaningful on shared lists
    writePresence({ typing: true });
    if(state.typingClearTimer) clearTimeout(state.typingClearTimer);
    state.typingClearTimer = setTimeout(() => writePresence({ typing: false }), 2500);
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQueryVal = e.target.value.trim();
    renderTasks();
  });

  document.getElementById('filterStatus').addEventListener('change', (e) => {
    state.filterStatusVal = e.target.value;
    renderTasks();
  });

  document.getElementById('filterPriority').addEventListener('change', (e) => {
    state.filterPriorityVal = e.target.value;
    renderTasks();
  });

  document.getElementById('filterTag').addEventListener('change', (e) => {
    state.filterTagVal = e.target.value;
    renderTasks();
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.currentSort = e.target.value;
    renderTasks();
  });
}
