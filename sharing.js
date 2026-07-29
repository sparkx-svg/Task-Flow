import {
  query, where, onSnapshot, doc, setDoc, updateDoc, getDocs, addDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db, listsCol, usersCol, presenceCol, reportError } from './firebase.js';
import { state, PRESENCE_STALE_MS, PRESENCE_HEARTBEAT_MS } from './state.js';
import { escapeHtml } from './ui.js';
import { clearSelection, subscribeToTasks } from './tasks.js';

// ---- Shared lists ----
export function subscribeToLists(){
  if(state.unsubscribeLists) state.unsubscribeLists();
  const q = query(listsCol, where('memberUids', 'array-contains', state.currentUser.uid));
  state.unsubscribeLists = onSnapshot(q, (snap) => {
    state.myLists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListSelect();
    renderAssigneeOptions();
  }, (err) => reportError('List sync error:', err));
}

export function getCurrentList(){
  return state.myLists.find(l => l.id === state.currentListId) || null;
}

export function renderListSelect(){
  const sel = document.getElementById('listSelect');
  const prevValue = sel.value || state.currentListId;
  sel.innerHTML = '<option value="__personal__">Personal</option>' +
    state.myLists.map(l => `<option value="${l.id}">${escapeHtml(l.name)} (shared)</option>`).join('');
  const wanted = state.currentListId === state.currentUser.uid ? '__personal__' : state.currentListId;
  sel.value = Array.from(sel.options).some(o => o.value === wanted) ? wanted : '__personal__';
  if(sel.value === '__personal__' && state.currentListId !== state.currentUser.uid) state.currentListId = state.currentUser.uid;
  const isShared = state.currentListId !== state.currentUser.uid;
  document.getElementById('shareListBtn').classList.toggle('hidden', !isShared);
}

export function switchList(value){
  state.currentListId = value === '__personal__' ? state.currentUser.uid : value;
  clearSelection();
  state.expandedTasks.clear();
  state.pageSize = 50;
  document.getElementById('shareListBtn').classList.toggle('hidden', value === '__personal__');
  renderAssigneeOptions();
  subscribeToTasks();
  subscribeToPresence();
  writePresence({ typing: false }); // announce arrival on the new list immediately
}

// ---- Presence: "who's viewing" + typing indicator on shared lists ----
function presenceDocId(listId, uid){ return `${listId}_${uid}`; }

export async function writePresence(extra){
  if(!state.currentUser || !state.currentListId) return;
  try{
    await setDoc(doc(db, 'presence', presenceDocId(state.currentListId, state.currentUser.uid)), {
      listId: state.currentListId,
      uid: state.currentUser.uid,
      name: state.currentUser.displayName || state.currentUser.email || 'Someone',
      lastActive: Date.now(),
      ...extra
    }, { merge: true });
  }catch(err){
    // Presence is best-effort — don't surface errors to the user for this.
    console.warn('Presence update failed:', err);
  }
}

export function startPresenceHeartbeat(){
  stopPresenceHeartbeat();
  state.presenceHeartbeatInterval = setInterval(() => writePresence({}), PRESENCE_HEARTBEAT_MS);
}
function stopPresenceHeartbeat(){
  if(state.presenceHeartbeatInterval){ clearInterval(state.presenceHeartbeatInterval); state.presenceHeartbeatInterval = null; }
}

function subscribeToPresence(){
  if(state.unsubscribePresence){ state.unsubscribePresence(); state.unsubscribePresence = null; }
  if(!state.currentListId){ renderPresence([]); return; }
  const isShared = state.currentListId !== state.currentUser.uid;
  if(!isShared){ renderPresence([]); return; } // presence bar only makes sense on shared lists
  const q = query(presenceCol, where('listId', '==', state.currentListId));
  state.unsubscribePresence = onSnapshot(q, (snap) => {
    const now = Date.now();
    const others = snap.docs
      .map(d => d.data())
      .filter(p => p.uid !== state.currentUser.uid && (now - (p.lastActive || 0)) < PRESENCE_STALE_MS);
    renderPresence(others);
  }, (err) => console.warn('Presence sync error:', err));
}

function renderPresence(others){
  const bar = document.getElementById('presenceBar');
  if(!bar) return;
  if(!others || others.length === 0){ bar.innerHTML = ''; return; }
  const now = Date.now();
  const initials = n => (n || '?').trim().charAt(0).toUpperCase();
  const avatars = others.map(p =>
    `<div class="presence-avatar" title="${escapeHtml(p.name)}${p.typing ? ' is typing…' : ' is viewing this list'}">${escapeHtml(initials(p.name))}</div>`
  ).join('');
  const typingOnes = others.filter(p => p.typing && (now - (p.lastActive || 0)) < 4000);
  const typingText = typingOnes.length
    ? `<span class="presence-typing">${escapeHtml(typingOnes.map(p => p.name).join(', '))} ${typingOnes.length === 1 ? 'is' : 'are'} typing…</span>`
    : `<span>${others.length} other${others.length > 1 ? 's' : ''} viewing this list</span>`;
  bar.innerHTML = `<div class="presence-avatars">${avatars}</div>${typingText}`;
}

export function stopPresence(){
  stopPresenceHeartbeat();
  if(state.unsubscribePresence){ state.unsubscribePresence(); state.unsubscribePresence = null; }
  if(state.typingClearTimer){ clearTimeout(state.typingClearTimer); state.typingClearTimer = null; }
  renderPresence([]);
}

export function renderAssigneeOptions(){
  const list = getCurrentList();
  const shared = !!list;
  const newSel = document.getElementById('newTaskAssignee');
  newSel.classList.toggle('hidden', !shared);
  if(shared){
    const members = list.memberEmails || [];
    newSel.innerHTML = '<option value="">Unassigned</option>' +
      members.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
  }
}

// ---- Share modal ----
export function openShareModal(){
  const list = getCurrentList();
  if(!list) return;
  document.getElementById('shareModalTitle').textContent = `Share "${list.name}"`;
  document.getElementById('shareInviteEmail').value = '';
  document.getElementById('shareModalError').textContent = '';
  renderShareModalMembers();
  document.getElementById('shareModalOverlay').classList.remove('hidden');
}
export function closeShareModal(){
  document.getElementById('shareModalOverlay').classList.add('hidden');
}
function renderShareModalMembers(){
  const list = getCurrentList();
  if(!list) return;
  const emails = list.memberEmails || [];
  document.getElementById('shareModalMembers').innerHTML = emails.map(e => `
    <div class="member-row">
      <span>${escapeHtml(e)}${e === state.currentUser.email ? ' (you, owner)' : ''}</span>
      ${(list.ownerId === state.currentUser.uid && e !== state.currentUser.email)
        ? `<button class="remove-member" onclick="removeMember('${escapeHtml(e)}')">Remove</button>` : ''}
    </div>`).join('');
}
export async function inviteToList(){
  const list = getCurrentList();
  if(!list) return;
  const emailInput = document.getElementById('shareInviteEmail');
  const errorEl = document.getElementById('shareModalError');
  const email = emailInput.value.trim().toLowerCase();
  errorEl.textContent = '';
  if(!email){ errorEl.textContent = 'Enter an email address.'; return; }
  if((list.memberEmails || []).map(e => e.toLowerCase()).includes(email)){
    errorEl.textContent = 'Already a member of this list.'; return;
  }
  const btn = document.getElementById('shareInviteBtn');
  btn.disabled = true;
  try{
    const q = query(usersCol, where('email', '==', email));
    const snap = await getDocs(q);
    if(snap.empty){
      errorEl.textContent = "No TaskFlow account found for that email — ask them to sign up first.";
      return;
    }
    const uid = snap.docs[0].id;
    await updateDoc(doc(db, 'lists', list.id), {
      memberUids: arrayUnion(uid),
      memberEmails: arrayUnion(email)
    });
    emailInput.value = '';
    renderShareModalMembers();
  }catch(err){
    reportError('Invite failed:', err);
    errorEl.textContent = 'Could not send invite: ' + (err.message || err.code);
  }finally{
    btn.disabled = false;
  }
}
export async function removeMember(email){
  const list = getCurrentList();
  if(!list || list.ownerId !== state.currentUser.uid) return;
  try{
    const snap = await getDocs(query(usersCol, where('email', '==', email)));
    const updates = { memberEmails: arrayRemove(email) };
    if(!snap.empty) updates.memberUids = arrayRemove(snap.docs[0].id);
    await updateDoc(doc(db, 'lists', list.id), updates);
    renderShareModalMembers();
  }catch(err){
    reportError('Failed to remove member:', err);
    alert('Could not remove member: ' + (err.message || err.code));
  }
}

// ---- New shared list ----
export function openNewListModal(){
  document.getElementById('newListName').value = '';
  document.getElementById('newListModalError').textContent = '';
  document.getElementById('newListModalOverlay').classList.remove('hidden');
}
export function closeNewListModal(){
  document.getElementById('newListModalOverlay').classList.add('hidden');
}
export async function createSharedList(){
  const nameInput = document.getElementById('newListName');
  const errorEl = document.getElementById('newListModalError');
  const name = nameInput.value.trim();
  if(!name){ errorEl.textContent = 'Give the list a name.'; return; }
  const btn = document.getElementById('newListCreateBtn');
  btn.disabled = true;
  try{
    const ref = await addDoc(listsCol, {
      name,
      ownerId: state.currentUser.uid,
      memberUids: [state.currentUser.uid],
      memberEmails: [state.currentUser.email],
      createdAt: Date.now()
    });
    closeNewListModal();
    state.currentListId = ref.id;
    // renderListSelect() will run on the next 'lists' snapshot; select it once it appears
    setTimeout(() => { document.getElementById('listSelect').value = ref.id; switchList(ref.id); }, 300);
  }catch(err){
    reportError('Failed to create list:', err);
    errorEl.textContent = 'Could not create list: ' + (err.message || err.code);
  }finally{
    btn.disabled = false;
  }
}
