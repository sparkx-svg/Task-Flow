import { state, UNDO_DELETE_MS } from './state.js';
import {
  filterTasks, sortTasks, isDragEnabled, updateDragHint, updateTagFilterOptions,
  formatDueDate, isOverdue, subtaskStats, toggleTask, startEditTask, deleteTask,
  saveEditTask, cancelEditTask
} from './tasks.js';

// ---- Theme (light/dark) ----
export function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem('taskflow-theme', next); }catch(e){}
  updateThemeBtn();
}
export function updateThemeBtn(){
  const btn = document.getElementById('themeToggleBtn');
  if(!btn) return;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  btn.textContent = isLight ? '☀' : '◐';
  btn.title = isLight ? 'Switch to dark theme' : 'Switch to light theme';
}

// ---- Density (compact/comfortable) ----
function getDensity(){
  try{ return localStorage.getItem('taskflow-density') || 'comfortable'; }catch(e){ return 'comfortable'; }
}
export function applyDensity(){
  const density = getDensity();
  document.getElementById('taskList').classList.toggle('compact', density === 'compact');
  const btn = document.getElementById('densityToggleBtn');
  if(btn) btn.title = density === 'compact' ? 'Switch to comfortable spacing' : 'Switch to compact spacing';
}
export function toggleDensity(){
  const next = getDensity() === 'compact' ? 'comfortable' : 'compact';
  try{ localStorage.setItem('taskflow-density', next); }catch(e){}
  applyDensity();
}

// ---- Keyboard shortcuts ----
// n = new task, / = focus search, j/k or ↓/↑ = navigate tasks,
// Enter/Space = toggle done, e = edit, Backspace/Delete = delete, Escape = clear focus
function getVisibleTasksForKb(){
  return sortTasks(filterTasks(state.tasksCache.filter(t => !state.pendingDeleteTimers.has(t.id))));
}
function moveKbFocus(delta){
  const visible = getVisibleTasksForKb();
  if(visible.length === 0){ state.kbFocusIndex = -1; return; }
  state.kbFocusIndex = Math.max(0, Math.min(visible.length - 1, state.kbFocusIndex + delta));
  const el = document.getElementById(`task-${visible[state.kbFocusIndex].id}`);
  if(el){
    document.querySelectorAll('.task-item.kb-focus').forEach(n => n.classList.remove('kb-focus'));
    el.classList.add('kb-focus');
    el.scrollIntoView({ block: 'nearest' });
  }
}

export function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function renderTasks(){
  updateDragHint();
  updateTagFilterOptions();
  const list = document.getElementById('taskList');
  // Hide tasks that are in the undo-delete grace period, so they disappear
  // from the list instantly while the actual Firestore delete is delayed.
  const visibleCache = state.tasksCache.filter(t => !state.pendingDeleteTimers.has(t.id));
  document.getElementById('statTotal').textContent = visibleCache.length;
  document.getElementById('statDone').textContent = visibleCache.filter(t=>t.status==='done').length;
  document.getElementById('statPending').textContent = visibleCache.filter(t=>t.status!=='done').length;

  const tasks = sortTasks(filterTasks(visibleCache));
  const dragOn = isDragEnabled();

  // Drop any selected ids that are no longer visible/present, keep the bulk bar honest
  const visibleIds = new Set(tasks.map(t => t.id));
  Array.from(state.selectedTaskIds).forEach(id => { if(!state.tasksCache.some(t => t.id === id)) state.selectedTaskIds.delete(id); });

  const bulkBar = document.getElementById('bulkBar');
  const bulkCount = document.getElementById('bulkCount');
  if(state.selectedTaskIds.size > 0){
    bulkBar.classList.remove('hidden');
    bulkCount.textContent = `${state.selectedTaskIds.size} selected`;
  }else{
    bulkBar.classList.add('hidden');
  }
  const selectAllBox = document.getElementById('selectAllCheckbox');
  const visibleSelectedCount = tasks.filter(t => state.selectedTaskIds.has(t.id)).length;
  selectAllBox.checked = tasks.length > 0 && visibleSelectedCount === tasks.length;
  selectAllBox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < tasks.length;

  if(visibleCache.length === 0){
    list.innerHTML = '<div class="empty-state">No tasks yet — add one above to get started.</div>';
    return;
  }
  if(tasks.length === 0){
    list.innerHTML = '<div class="empty-state">No tasks match your filters.</div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    const dueTag = t.dueDate
      ? `<div class="due-tag ${isOverdue(t)?'overdue':''}">${isOverdue(t)?'Overdue ':'Due '}${formatDueDate(t.dueDate)}</div>`
      : '';
    const recurLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[t.recurrence];
    const recurTag = recurLabel ? `<div class="recur-tag">↻ ${recurLabel}</div>` : '';
    const tagChips = (t.tags || []).map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('');
    const listForTask = state.myLists.find(l => l.id === t.listId);
    const assigneeControl = listForTask
      ? `<select class="assignee-select" onchange="reassignTask('${t.id}', this.value)" aria-label="Assignee">
           <option value="">Unassigned</option>
           ${(listForTask.memberEmails || []).map(e => `<option value="${escapeHtml(e)}" ${t.assigneeEmail===e?'selected':''}>${escapeHtml(e)}</option>`).join('')}
         </select>`
      : (t.assigneeEmail ? `<span class="assignee-chip">${escapeHtml(t.assigneeEmail)}</span>` : '');

    if(t.id === state.editingTaskId){
      return `
    <div class="task-item">
      <div class="task-check ${t.status==='done'?'checked':''}" role="checkbox" aria-checked="${t.status==='done'}" tabindex="0" onclick="toggleTask('${t.id}', '${t.status}')"></div>
      <input class="edit-title-input" id="editInput-${t.id}" value="${escapeHtml(t.title)}" />
      <input type="date" class="edit-priority-select" id="editDueDate-${t.id}" value="${t.dueDate || ''}" />
      <select class="edit-priority-select" id="editPriority-${t.id}">
        <option value="low" ${t.priority==='low'?'selected':''}>Low</option>
        <option value="medium" ${t.priority==='medium'?'selected':''}>Medium</option>
        <option value="high" ${t.priority==='high'?'selected':''}>High</option>
      </select>
      <input type="text" class="edit-tags-input" id="editTags-${t.id}" placeholder="Tags, comma separated" value="${escapeHtml((t.tags||[]).join(', '))}" />
      <select class="edit-priority-select" id="editRecurrence-${t.id}">
        <option value="" ${!t.recurrence?'selected':''}>No repeat</option>
        <option value="daily" ${t.recurrence==='daily'?'selected':''}>Repeat daily</option>
        <option value="weekly" ${t.recurrence==='weekly'?'selected':''}>Repeat weekly</option>
        <option value="monthly" ${t.recurrence==='monthly'?'selected':''}>Repeat monthly</option>
      </select>
      <button class="save-btn" onclick="saveEditTask('${t.id}')" aria-label="Save task">✓</button>
      <button class="del-btn" onclick="cancelEditTask()" aria-label="Cancel edit">✕</button>
    </div>`;
    }

    const { total: subTotal, done: subDone, pct: subPct } = subtaskStats(t);
    const expanded = state.expandedTasks.has(t.id);
    const subtaskToggle = `<button class="subtask-toggle" onclick="toggleExpandTask('${t.id}')">☰ ${subTotal ? `${subDone}/${subTotal}` : 'Steps'}</button>`;
    const progressMini = subTotal
      ? `<div class="progress-mini" title="${subDone}/${subTotal} steps done"><div class="progress-mini-fill" style="width:${subPct}%"></div></div>`
      : '';
    const subtaskPanel = expanded ? `
      <div class="subtask-panel">
        ${(t.subtasks || []).map(s => `
          <div class="subtask-row">
            <div class="subtask-check ${s.done?'checked':''}" onclick="toggleSubtask('${t.id}','${s.id}')"></div>
            <div class="subtask-label ${s.done?'done':''}">${escapeHtml(s.title)}</div>
            <button class="subtask-del" onclick="deleteSubtask('${t.id}','${s.id}')" aria-label="Delete step">✕</button>
          </div>`).join('')}
        <div class="subtask-add-row">
          <input type="text" class="subtask-input" id="subtaskInput-${t.id}" placeholder="Add a step..." onkeypress="if(event.key==='Enter') addSubtask('${t.id}')">
          <button onclick="addSubtask('${t.id}')">+</button>
        </div>
      </div>` : '';

    return `
    <div class="task-item ${t.status==='done'?'done':''}" id="task-${t.id}"
         ${dragOn ? `draggable="true" ondragstart="dragTaskStart(event,'${t.id}')" ondragover="dragTaskOver(event,'${t.id}')" ondragleave="dragTaskLeave(event,'${t.id}')" ondrop="dragTaskDrop(event,'${t.id}')" ondragend="dragTaskEnd(event)"` : ''}>
      ${dragOn ? '<span class="drag-handle">⠿</span>' : ''}
      <input type="checkbox" class="select-check" ${state.selectedTaskIds.has(t.id)?'checked':''} onchange="toggleSelectTask('${t.id}', this.checked)" aria-label="Select task">
      <div class="task-check ${t.status==='done'?'checked':''}" role="checkbox" aria-checked="${t.status==='done'}" tabindex="0" onclick="toggleTask('${t.id}', '${t.status}')"></div>
      <div class="task-title">${escapeHtml(t.title)}</div>
      ${progressMini}
      ${tagChips}
      ${recurTag}
      ${dueTag}
      <div class="priority-tag priority-${t.priority}">${t.priority}</div>
      ${assigneeControl}
      ${subtaskToggle}
      <button class="edit-btn" onclick="startEditTask('${t.id}')" aria-label="Edit task">✎</button>
      <button class="del-btn" onclick="deleteTask('${t.id}')" aria-label="Delete task">✕</button>
      ${subtaskPanel}
    </div>`;
  }).join('');

  if(state.editingTaskId){
    const input = document.getElementById(`editInput-${state.editingTaskId}`);
    if(input){
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') saveEditTask(state.editingTaskId);
        if(e.key === 'Escape') cancelEditTask();
      });
    }
  }
}

// ---- Toasts (undo delete) ----
export function showToast(message, onUndo, toastId){
  const stack = document.getElementById('toastStack');
  const id = toastId != null ? `toast-${toastId}` : `toast-anon-${state.toastSeq++}`;
  const existing = document.getElementById(id);
  if(existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.id = id;
  el.innerHTML = `<span></span>`;
  el.querySelector('span').textContent = message;
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  btn.onclick = () => { onUndo(); el.remove(); };
  el.appendChild(btn);
  stack.appendChild(el);
  setTimeout(() => { if(document.getElementById(id)) document.getElementById(id).remove(); }, UNDO_DELETE_MS + 300);
}
export function dismissToast(toastId){
  const el = document.getElementById(`toast-${toastId}`);
  if(el) el.remove();
}

// Wires up the global keydown shortcuts. Called once from main.js.
export function initUI(){
  document.addEventListener('keydown', (e) => {
    if(document.getElementById('dashboard').classList.contains('hidden')) return; // only while signed in
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement.isContentEditable;
    const modalOpen = !document.getElementById('profileModalOverlay').classList.contains('hidden') ||
      !document.getElementById('shareModalOverlay').classList.contains('hidden') ||
      !document.getElementById('newListModalOverlay').classList.contains('hidden');
    if(modalOpen) return;
    if(e.key === '/' && !typing){
      e.preventDefault();
      document.getElementById('searchInput').focus();
      return;
    }
    if((e.key === 'n' || e.key === 'N') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey){
      e.preventDefault();
      document.getElementById('newTaskTitle').focus();
      return;
    }
    if(typing || state.editingTaskId) return; // everything below only applies to list navigation, not while typing/editing

    if(e.key === 'j' || e.key === 'ArrowDown'){
      e.preventDefault();
      moveKbFocus(1);
    }else if(e.key === 'k' || e.key === 'ArrowUp'){
      e.preventDefault();
      moveKbFocus(-1);
    }else if(e.key === 'Escape'){
      state.kbFocusIndex = -1;
      document.querySelectorAll('.task-item.kb-focus').forEach(n => n.classList.remove('kb-focus'));
    }else if(state.kbFocusIndex >= 0){
      const visible = getVisibleTasksForKb();
      const focused = visible[state.kbFocusIndex];
      if(!focused) return;
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        toggleTask(focused.id, focused.status);
      }else if(e.key === 'e' || e.key === 'E'){
        e.preventDefault();
        startEditTask(focused.id);
      }else if(e.key === 'Backspace' || e.key === 'Delete'){
        e.preventDefault();
        deleteTask(focused.id);
      }
    }
  });
}
