import { initAuth, showRegister, showLogin, logout, handleForgotPassword, togglePasswordVisibility,
  handleGoogleSignIn, openProfileModal, closeProfileModal, saveProfile, resendVerificationEmail,
  recheckVerification, dismissVerifyBanner, deleteAccount } from './auth.js';
import { initTasks, addTask, toggleTask, deleteTask, startEditTask, saveEditTask, cancelEditTask,
  dragTaskStart, dragTaskOver, dragTaskLeave, dragTaskDrop, dragTaskEnd, toggleExpandTask,
  addSubtask, toggleSubtask, deleteSubtask, toggleSelectTask, toggleSelectAll, bulkMarkDone,
  bulkMarkPending, bulkSetPriority, bulkDelete, clearSelection, exportTasksJSON, exportTasksCSV,
  handleImportFile, undoDeleteTask, reassignTask, loadMoreTasks, toggleReminders } from './tasks.js';
import { switchList, openShareModal, closeShareModal, inviteToList, removeMember,
  openNewListModal, closeNewListModal, createSharedList } from './sharing.js';
import { initUI, toggleTheme, toggleDensity } from './ui.js';

// Every function an inline onclick/onchange/oninput attribute in index.html calls has to be
// reachable on `window`, since ES module scope isn't global scope. This list mirrors the
// original file's own hand-maintained export block.
window.showRegister = showRegister;
window.showLogin = showLogin;
window.logout = logout;
window.addTask = addTask;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.startEditTask = startEditTask;
window.saveEditTask = saveEditTask;
window.cancelEditTask = cancelEditTask;
window.handleForgotPassword = handleForgotPassword;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleGoogleSignIn = handleGoogleSignIn;
window.dragTaskStart = dragTaskStart;
window.dragTaskOver = dragTaskOver;
window.dragTaskLeave = dragTaskLeave;
window.dragTaskDrop = dragTaskDrop;
window.dragTaskEnd = dragTaskEnd;
window.toggleExpandTask = toggleExpandTask;
window.addSubtask = addSubtask;
window.toggleSubtask = toggleSubtask;
window.deleteSubtask = deleteSubtask;
window.toggleSelectTask = toggleSelectTask;
window.toggleSelectAll = toggleSelectAll;
window.bulkMarkDone = bulkMarkDone;
window.bulkMarkPending = bulkMarkPending;
window.bulkSetPriority = bulkSetPriority;
window.bulkDelete = bulkDelete;
window.clearSelection = clearSelection;
window.switchList = switchList;
window.openShareModal = openShareModal;
window.closeShareModal = closeShareModal;
window.inviteToList = inviteToList;
window.removeMember = removeMember;
window.openNewListModal = openNewListModal;
window.closeNewListModal = closeNewListModal;
window.createSharedList = createSharedList;
window.exportTasksJSON = exportTasksJSON;
window.exportTasksCSV = exportTasksCSV;
window.handleImportFile = handleImportFile;
window.undoDeleteTask = undoDeleteTask;
window.reassignTask = reassignTask;
window.toggleTheme = toggleTheme;
window.toggleDensity = toggleDensity;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
window.resendVerificationEmail = resendVerificationEmail;
window.recheckVerification = recheckVerification;
window.dismissVerifyBanner = dismissVerifyBanner;
window.deleteAccount = deleteAccount;
window.loadMoreTasks = loadMoreTasks;
window.toggleReminders = toggleReminders;
window.installApp = installApp;

// ---- Wire up each module's DOM listeners, then start the auth flow ----
initAuth();
initTasks();
initUI();

// ---- PWA: service worker registration + install prompt ----
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err); // non-fatal — app still works online
    });
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installBtn');
  if(btn) btn.classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('installBtn');
  if(btn) btn.classList.add('hidden');
});
async function installApp(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice; // resolves once the user accepts/dismisses
  deferredInstallPrompt = null;
  document.getElementById('installBtn').classList.add('hidden');
}

// ---- Brand panel signature animation: the ledger ticks itself off in a loop ----
(function runLedgerAnimation(){
  const rows = Array.from(document.querySelectorAll('.ledger-row'));
  const countEl = document.getElementById('ledgerCount');
  if(rows.length === 0) return;
  let step = 0;
  const total = rows.length;

  function tick(){
    const doneCount = step % (total + 1);
    rows.forEach((row, i) => row.classList.toggle('done', i < doneCount));
    countEl.textContent = `${doneCount}/${total}`;
    step++;
    const delay = doneCount === total ? 1600 : (doneCount === 0 ? 500 : 900);
    setTimeout(tick, delay);
  }
  tick();
})();
