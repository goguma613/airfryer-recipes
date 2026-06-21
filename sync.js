// sync.js — 선택적 Firebase 동기화 (로컬 우선 설계).
// firebase SDK는 "설정됨 + 필요할 때"만 동적 로드 → 오프라인/미설정이어도 앱은 로컬로 동작.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';

let _authMod = null, _fsMod = null;
let app = null, auth = null, db = null, provider = null;
let _user = null;
let _unsub = null;
let _cb = {};
let _ready = false;
let _pushTimer = null;
let _lastSyncedJSON = null;   // 내가 마지막으로 올린(또는 받은) 데이터 — 에코 무시용

export function isConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE'));
}
export function currentUser() { return _user; }

// 콜백: onUser(user|null), onStatus(str), onInitialRemote(data), onAfterInitial(), onRemoteData(data)
export async function initSync(callbacks) {
  _cb = callbacks || {};
  if (!isConfigured()) { emit('unconfigured'); return; }
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    _authMod = authMod; _fsMod = fsMod;
    app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    provider = new authMod.GoogleAuthProvider();
    // 로그아웃 후 다시 로그인할 때 이전 계정이 자동 선택되지 않도록 항상 계정 선택창을 띄운다.
    provider.setCustomParameters({ prompt: 'select_account' });
    _ready = true;
    // 모바일 redirect 복귀 처리. 실패를 조용히 삼키지 말고 상태로 노출한다.
    authMod.getRedirectResult(auth).catch((e) => {
      console.warn('redirect 로그인 결과 처리 실패', e);
      emit('error', (e && e.code) || 'redirect');
    });
    authMod.onAuthStateChanged(auth, (user) => {
      _user = user;
      _cb.onUser && _cb.onUser(user);
      if (user) startSubscribe(); else stopSubscribe();
    });
    emit('ready');
  } catch (e) {
    console.warn('Firebase 로드 실패(오프라인 등) — 로컬로 계속', e);
    emit('offline');
  }
}

export async function signIn() {
  if (!_ready) return;
  emit('signing');
  try {
    await _authMod.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e && e.code) || '';
    if (code.includes('popup') || code.includes('not-supported') || code.includes('cancelled')) {
      try { await _authMod.signInWithRedirect(auth, provider); return; } catch (e2) { /* fall */ }
    }
    emit('error', code || (e && e.message));
  }
}

export async function signOutUser() {
  if (_ready) { try { await _authMod.signOut(auth); } catch (e) {} }
}

function startSubscribe() {
  if (!_ready || !_user) return;
  const ref = _fsMod.doc(db, 'users', _user.uid);
  emit('syncing');
  _fsMod.getDoc(ref).then((snap) => {
    if (snap.exists() && snap.data() && snap.data().data) {
      _cb.onInitialRemote && _cb.onInitialRemote(snap.data().data);  // 최초 1회 머지
    }
    _cb.onAfterInitial && _cb.onAfterInitial();                      // 머지 결과 업로드
    _unsub = _fsMod.onSnapshot(ref, (s) => {
      if (s.metadata.hasPendingWrites) return;        // 내 로컬 쓰기 에코 무시
      if (!s.exists()) return;
      const d = s.data() && s.data().data;
      if (!d) return;
      const json = JSON.stringify(d);
      if (json === _lastSyncedJSON) return;            // 동일 데이터면 무시
      _lastSyncedJSON = json;
      _cb.onRemoteData && _cb.onRemoteData(d);
    }, (err) => emit('error', err && err.code));
    emit('synced');
  }).catch((e) => emit('error', e && e.code));
}

function stopSubscribe() { if (_unsub) { _unsub(); _unsub = null; } }

// 로컬 변경 → 디바운스 후 업로드 (로그인 상태에서만)
export function pushData(data) {
  if (!_ready || !_user) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    try {
      const json = JSON.stringify(data);
      _lastSyncedJSON = json;
      await _fsMod.setDoc(_fsMod.doc(db, 'users', _user.uid), { data, updatedAt: Date.now() });
      emit('synced');
    } catch (e) { emit('error', e && e.code); }
  }, 700);
}

function emit(status, detail) { _cb.onStatus && _cb.onStatus(status, detail); }
