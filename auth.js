import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup, setPersistence,
  browserLocalPersistence, browserSessionPersistence,
  sendEmailVerification, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, updateDoc, getDocs, query, where, writeBatch, deleteDoc, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, tasksCol, reportError } from './firebase.js';
import { state } from './state.js';
import { subscribeToLists, startPresenceHeartbeat, stopPresence } from './sharing.js';
import { subscribeToTasks, updateReminderBtn, stopReminderChecks } from './tasks.js';
import { updateThemeBtn, applyDensity } from './ui.js';

export function showRegister(){
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
  document.getElementById('switchToRegister').classList.add('hidden');
  document.getElementById('switchToLogin').classList.remove('hidden');
  document.getElementById('authHeading').textContent = 'Create your account';
  document.getElementById('authSub').textContent = 'Create an account to get started.';
}
export function showLogin(){
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('switchToLogin').classList.add('hidden');
  document.getElementById('switchToRegister').classList.remove('hidden');
  document.getElementById('authHeading').textContent = 'Welcome back';
  document.getElementById('authSub').textContent = 'Sign in to manage your tasks.';
}

export function togglePasswordVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? 'Show' : 'Hide';
}

// Pure logic — no DOM — so it's a good first candidate for a unit test.
export function scorePasswordStrength(pw){
  if(!pw) return 0;
  let score = 0;
  if(pw.length >= 6) score++;
  if(pw.length >= 10) score++;
  if(/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if(/\d/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function setBtnLoading(form, loading, loadingText, normalText){
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = loading;
  btn.textContent = loading ? loadingText : normalText;
}

export async function handleGoogleSignIn(){
  const btn = document.getElementById('googleBtn');
  btn.disabled = true;
  const originalText = btn.innerHTML;
  try{
    await setPersistence(auth, browserLocalPersistence);
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    // onAuthStateChanged below handles entering the dashboard
  }catch(err){
    if(err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request'){
      const loginVisible = !document.getElementById('loginForm').classList.contains('hidden');
      const errEl = document.getElementById(loginVisible ? 'loginError' : 'regError');
      errEl.textContent = friendlyAuthError(err);
    }
  }finally{
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

export async function handleForgotPassword(){
  const errEl = document.getElementById('loginError');
  const email = document.getElementById('loginEmail').value.trim();
  errEl.style.color = '';
  if(!email){
    errEl.textContent = 'Enter your email above first, then click "Forgot password?".';
    return;
  }
  try{
    await sendPasswordResetEmail(auth, email);
    errEl.style.color = 'var(--success)';
    errEl.textContent = 'Password reset email sent — check your inbox.';
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
  }
}

function friendlyAuthError(err){
  const map = {
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.'
  };
  const friendly = map[err.code] || 'Something went wrong.';
  return `${friendly} (${err.code || err.message})`;
}

function enterDashboard(){
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  updateThemeBtn();
  applyDensity();
  updateReminderBtn();
  startPresenceHeartbeat();
  const displayName = state.currentUser.displayName || state.currentUser.email;
  document.getElementById('userName').textContent = displayName;
  document.getElementById('userAvatar').textContent = displayName.charAt(0).toUpperCase();
  state.currentListId = state.currentUser.uid; // default to personal list
  // Keep a lightweight profile doc so other users can find this account by email
  // when inviting them to a shared list (Firestore can't query auth users by email).
  setDoc(doc(db, 'users', state.currentUser.uid), {
    email: state.currentUser.email,
    displayName: displayName
  }, { merge: true }).catch(err => reportError('Failed to sync user profile:', err));
  updateVerifyBanner();
  subscribeToLists();
  subscribeToTasks();
}

function updateVerifyBanner(){
  const banner = document.getElementById('verifyBanner');
  const show = state.currentUser && !state.currentUser.emailVerified &&
    state.currentUser.providerData.some(p => p.providerId === 'password') && // Google accounts are pre-verified
    !state.verifyBannerDismissed;
  banner.classList.toggle('hidden', !show);
}
export function dismissVerifyBanner(){
  state.verifyBannerDismissed = true;
  updateVerifyBanner();
}
export async function resendVerificationEmail(){
  try{
    await sendEmailVerification(state.currentUser);
    alert('Verification email sent — check your inbox.');
  }catch(err){
    reportError('Failed to send verification email:', err);
    alert('Could not send verification email: ' + (err.message || err.code));
  }
}
export async function recheckVerification(){
  try{
    await state.currentUser.reload();
    state.currentUser = auth.currentUser;
    updateVerifyBanner();
    renderProfileModal();
    if(state.currentUser.emailVerified) alert("You're verified!");
    else alert("Still not verified yet — check your inbox (and spam folder).");
  }catch(err){
    reportError('Failed to refresh verification status:', err);
  }
}

export async function logout(){
  if(state.unsubscribeTasks){ state.unsubscribeTasks(); state.unsubscribeTasks = null; }
  if(state.unsubscribeLists){ state.unsubscribeLists(); state.unsubscribeLists = null; }
  state.pendingDeleteTimers.forEach(t => clearTimeout(t));
  state.pendingDeleteTimers.clear();
  document.getElementById('toastStack').innerHTML = '';
  state.editingTaskId = null;
  state.myLists = [];
  state.currentListId = null;
  state.verifyBannerDismissed = false;
  state.pageSize = 50;
  stopReminderChecks();
  stopPresence();
  await signOut(auth);
}

// ---- Account settings modal ----
export function openProfileModal(){
  renderProfileModal();
  document.getElementById('profileModalError').textContent = '';
  document.getElementById('profileModalOverlay').classList.remove('hidden');
}
export function closeProfileModal(){
  document.getElementById('profileModalOverlay').classList.add('hidden');
}
function renderProfileModal(){
  if(!state.currentUser) return;
  document.getElementById('profileNameInput').value = state.currentUser.displayName || '';
  document.getElementById('profilePhotoInput').value = state.currentUser.photoURL || '';
  document.getElementById('profileEmailLine').textContent = state.currentUser.email || '';
  const img = document.getElementById('profilePhotoPreview');
  const fallback = document.getElementById('profilePhotoFallback');
  if(state.currentUser.photoURL){
    img.src = state.currentUser.photoURL;
    img.style.display = 'block';
    fallback.style.display = 'none';
  }else{
    img.style.display = 'none';
    fallback.style.display = 'flex';
    fallback.textContent = (state.currentUser.displayName || state.currentUser.email || '?').charAt(0).toUpperCase();
  }
  const badge = document.getElementById('profileVerifiedBadge');
  const isPasswordAccount = state.currentUser.providerData.some(p => p.providerId === 'password');
  if(!isPasswordAccount){
    badge.textContent = 'Verified via Google';
    badge.className = 'verified-badge yes';
    document.getElementById('profileResendBtn').style.display = 'none';
  }else if(state.currentUser.emailVerified){
    badge.textContent = 'Verified';
    badge.className = 'verified-badge yes';
    document.getElementById('profileResendBtn').style.display = 'none';
  }else{
    badge.textContent = 'Not verified';
    badge.className = 'verified-badge no';
    document.getElementById('profileResendBtn').style.display = 'inline-block';
  }
}
export async function saveProfile(){
  const nameInput = document.getElementById('profileNameInput');
  const photoInput = document.getElementById('profilePhotoInput');
  const errorEl = document.getElementById('profileModalError');
  const name = nameInput.value.trim();
  const photoURL = photoInput.value.trim();
  if(!name){ errorEl.textContent = 'Display name can\'t be empty.'; return; }
  const btn = document.getElementById('profileSaveBtn');
  btn.disabled = true;
  errorEl.textContent = '';
  try{
    await updateProfile(state.currentUser, { displayName: name, photoURL: photoURL || null });
    await setDoc(doc(db, 'users', state.currentUser.uid), { displayName: name }, { merge: true });
    document.getElementById('userName').textContent = name;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    closeProfileModal();
  }catch(err){
    reportError('Failed to update profile:', err);
    errorEl.textContent = 'Could not save changes: ' + (err.message || err.code);
  }finally{
    btn.disabled = false;
  }
}
export async function deleteAccount(){
  if(!confirm('Delete your account? This permanently removes your personal tasks and can\'t be undone.')) return;
  if(!confirm('Are you absolutely sure? This is your last chance to cancel.')) return;
  const btn = document.getElementById('deleteAccountBtn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try{
    const uid = state.currentUser.uid;
    // Best-effort cleanup of this user's own data before removing the auth account.
    const ownTasksSnap = await getDocs(query(tasksCol, where('userId', '==', uid)));
    const personalTasks = ownTasksSnap.docs.filter(d => {
      const data = d.data();
      return !data.listId || data.listId === uid;
    });
    for(let i = 0; i < personalTasks.length; i += 400){
      const batch = writeBatch(db);
      personalTasks.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    const ownedLists = state.myLists.filter(l => l.ownerId === uid);
    const memberLists = state.myLists.filter(l => l.ownerId !== uid);
    for(const l of ownedLists){ await deleteDoc(doc(db, 'lists', l.id)).catch(() => {}); }
    for(const l of memberLists){
      await updateDoc(doc(db, 'lists', l.id), {
        memberUids: arrayRemove(uid),
        memberEmails: arrayRemove(state.currentUser.email)
      }).catch(() => {});
    }
    await deleteDoc(doc(db, 'users', uid)).catch(() => {});
    await deleteUser(state.currentUser);
    // onAuthStateChanged handles returning to the auth screen.
  }catch(err){
    reportError('Account deletion failed:', err);
    if(err.code === 'auth/requires-recent-login'){
      alert('For security, please log out and log back in, then try deleting your account again.');
    }else{
      alert('Could not delete account: ' + (err.message || err.code));
    }
  }finally{
    btn.disabled = false;
    btn.textContent = 'Delete my account';
  }
}

// Wires up the login/register forms and the auth-state listener. Called once from main.js.
export function initAuth(){
  // Fires on login, register, logout, and on page load if a session exists
  onAuthStateChanged(auth, (user) => {
    if(user){
      state.currentUser = user;
      enterDashboard();
    }else{
      state.currentUser = null;
      document.getElementById('dashboard').classList.add('hidden');
      document.getElementById('authScreen').classList.remove('hidden');
      showLogin();
    }
  });

  document.getElementById('regPassword').addEventListener('input', (e) => {
    const fill = document.getElementById('strengthFill');
    const label = document.getElementById('strengthLabel');
    const pw = e.target.value;
    if(!pw){
      fill.style.width = '0%';
      label.textContent = '';
      return;
    }
    const score = scorePasswordStrength(pw);
    const levels = [
      { pct: '20%', color: 'var(--ruby)', text: 'Too weak' },
      { pct: '40%', color: 'var(--ruby)', text: 'Weak' },
      { pct: '65%', color: 'var(--brass)', text: 'Fair' },
      { pct: '85%', color: 'var(--sage)', text: 'Good' },
      { pct: '100%', color: 'var(--sage)', text: 'Strong' }
    ];
    const level = levels[score];
    fill.style.width = level.pct;
    fill.style.background = level.color;
    label.textContent = level.text;
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if(!email || !password){
      errEl.textContent = 'Please fill in both fields.';
      return;
    }

    const rememberMe = document.getElementById('rememberMe').checked;
    setBtnLoading(form, true, 'Signing in…', 'Sign In');
    try{
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged above handles entering the dashboard
    }catch(err){
      errEl.textContent = friendlyAuthError(err);
    }finally{
      setBtnLoading(form, false, 'Signing in…', 'Sign In');
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errEl = document.getElementById('regError');
    errEl.textContent = '';
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;

    if(!name || !email || !password){
      errEl.textContent = 'Please fill in all fields.';
      return;
    }
    if(password.length < 6){
      errEl.textContent = 'Password must be at least 6 characters.';
      return;
    }

    setBtnLoading(form, true, 'Creating account…', 'Create Account');
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      sendEmailVerification(cred.user).catch(err => reportError('Failed to send verification email:', err));
      // onAuthStateChanged above handles entering the dashboard
    }catch(err){
      errEl.textContent = friendlyAuthError(err);
    }finally{
      setBtnLoading(form, false, 'Creating account…', 'Create Account');
    }
  });
}
