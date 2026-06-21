// store.js — 상태 + localStorage I/O + 마이그레이션 + import/export 검증
// 순수 데이터 계층. DOM 의존 없음.

export const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'airfryer-recipes';

// ---------------------------------------------------------------------------
// 기본 구조 / 시드
// ---------------------------------------------------------------------------

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    myDevices: [],
    recipes: [],
    settings: {
      lastBackupAt: null,   // ISO 문자열
      changeCount: 0,       // 마지막 백업 이후 변경 횟수
      lastUsed: {},         // recipeId -> { deviceId, amount }
    },
  };
}

// 첫 실행 시드: 기기 1대 + 대표 레시피(복제용 템플릿)
function seedState() {
  const s = emptyState();
  const deviceId = uid();
  s.myDevices.push({
    id: deviceId,
    updatedAt: now(),
    deletedAt: null,
    name: '내 에어프라이어',
    type: 'basket',          // basket | oven | lid
    wattage: 1500,
    capacity: 5,
    preheat: false,
    factorOverride: null,
    memo: '스펙은 실제 기기에 맞게 수정하세요.',
  });

  const mk = (r) => ({
    id: uid(),
    updatedAt: now(),
    deletedAt: null,
    name: r.name,
    category: r.category,
    favorite: false,
    source: r.source || 'package',
    baseTemp: r.baseTemp,
    baseTime: r.baseTime,
    baseAmount: r.baseAmount ?? null,
    gramsPerServing: r.gramsPerServing ?? null,
    baseDeviceId: deviceId,
    flip: r.flip ?? true,
    riskFood: r.riskFood ?? false,
    targetCoreTemp: r.targetCoreTemp ?? null,
    startState: r.startState || 'frozen',
    layering: r.layering || 'single',     // single | stacked
    loadDensity: r.loadDensity || 'single', // single | half | full
    steps: r.steps || [],
    memo: r.memo || '',
    successLog: [],
  });

  s.recipes.push(
    mk({ name: '냉동 감자튀김', category: '냉동식품', baseTemp: 200, baseTime: 15, baseAmount: 300,
         gramsPerServing: 150, startState: 'frozen', riskFood: false,
         steps: [{ atMin: 8, label: '한 번 흔들기' }], memo: '봉지 표기 기준. 바삭하게 하려면 +2~3분.' }),
    mk({ name: '닭다리(생)', category: '육류', baseTemp: 190, baseTime: 22, baseAmount: 400,
         startState: 'chilled', riskFood: true, targetCoreTemp: 74,
         steps: [{ atMin: 12, label: '뒤집기' }], memo: '중심온도 74℃ 확인 필수.' }),
    mk({ name: '식빵 토스트', category: '베이커리', baseTemp: 180, baseTime: 5, baseAmount: 60,
         startState: 'room', riskFood: false, flip: true,
         steps: [{ atMin: 3, label: '뒤집기' }], memo: '' }),
  );
  return s;
}

// ---------------------------------------------------------------------------
// id 생성
// ---------------------------------------------------------------------------
export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // 폴백 (구형 브라우저)
  return 'id-' + Math.abs(hashStr(String(performance.now()) + ':' + (uid._c = (uid._c || 0) + 1)));
}
// 동기화 머지 비교용 타임스탬프(epoch ms). 단조 증가만 하면 됨.
function now() { return Date.now(); }
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return h;
}

// ---------------------------------------------------------------------------
// 마이그레이션
// ---------------------------------------------------------------------------
// 버전별 변환 체인. 새 버전이 생기면 케이스 추가.
export function migrate(data) {
  let d = data;
  if (!d || typeof d !== 'object') return seedState();
  let v = d.schemaVersion || 0;

  // v0 -> v1: 초기. settings 누락 시 보강.
  if (v < 1) {
    d.myDevices = Array.isArray(d.myDevices) ? d.myDevices : [];
    d.recipes = Array.isArray(d.recipes) ? d.recipes : [];
    d.settings = d.settings || { lastBackupAt: null, changeCount: 0, lastUsed: {} };
    v = 1;
  }

  d.schemaVersion = SCHEMA_VERSION;
  // 누락 필드 보강 (스키마 진화 대비)
  d.settings = Object.assign({ lastBackupAt: null, changeCount: 0, lastUsed: {} }, d.settings || {});
  d.recipes = (d.recipes || []).map(normalizeRecipe);
  d.myDevices = (d.myDevices || []).map(normalizeDevice);
  return d;
}

function normalizeDevice(x) {
  return {
    id: x.id || uid(),
    updatedAt: numOrZero(x.updatedAt),     // 머지 LWW 키
    deletedAt: x.deletedAt ? numOrZero(x.deletedAt) : null,  // tombstone
    name: x.name || '이름 없음',
    type: x.type || 'basket',
    wattage: numOrNull(x.wattage),
    capacity: numOrNull(x.capacity),
    preheat: !!x.preheat,
    factorOverride: x.factorOverride ?? null,
    memo: x.memo || '',
  };
}
function normalizeRecipe(x) {
  return {
    id: x.id || uid(),
    updatedAt: numOrZero(x.updatedAt),     // 머지 LWW 키
    deletedAt: x.deletedAt ? numOrZero(x.deletedAt) : null,  // tombstone
    name: x.name || '이름 없음',
    category: x.category || '기타',
    favorite: !!x.favorite,
    source: x.source || 'manual',
    baseTemp: numOrNull(x.baseTemp),
    baseTime: numOrNull(x.baseTime),
    baseAmount: numOrNull(x.baseAmount),
    gramsPerServing: numOrNull(x.gramsPerServing),   // 1인분 기준량(g) — 있으면 조리화면서 인분 입력
    baseDeviceId: x.baseDeviceId || null,
    flip: x.flip ?? true,
    riskFood: !!x.riskFood,
    targetCoreTemp: numOrNull(x.targetCoreTemp),
    startState: x.startState || 'room',
    layering: x.layering || 'single',
    loadDensity: x.loadDensity || 'single',
    steps: Array.isArray(x.steps) ? x.steps.filter(s => s && typeof s.atMin === 'number') : [],
    memo: x.memo || '',
    successLog: normalizeLog(x.successLog),
  };
}
// successLog 엔트리에 안정적인 id 부여(머지 union 키). 레거시(무 id) 엔트리는
// 내용 해시로 결정적 id를 만들어 기기 간 중복 합산을 막는다.
function normalizeLog(arr) {
  return (Array.isArray(arr) ? arr : []).map(e => {
    if (!e || typeof e !== 'object') return null;
    const entry = Object.assign({}, e);
    if (!entry.id) entry.id = legacyLogId(entry);
    return entry;
  }).filter(Boolean);
}
function legacyLogId(e) {
  const key = JSON.stringify([e.date, e.deviceId, e.actualTemp, e.actualTime, e.actualAmount, e.coreTemp, e.result]);
  return 'lg-' + Math.abs(hashStr(key));
}
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// 로드 / 저장
// ---------------------------------------------------------------------------
let _state = null;

export function loadState() {
  if (_state) return _state;
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
  if (!raw) {
    _state = emptyState();   // 시드는 boot에서 조건부로(로그인 사용자엔 안 함) → 샘플 재유입 버그 방지
    persist();
    return _state;
  }
  try {
    _state = migrate(JSON.parse(raw));
    gcTombstones();   // 오래된 삭제 표식 정리(앱 시작 시 1회)
  } catch (e) {
    console.error('저장 데이터 파싱 실패, 시드로 대체', e);
    _state = seedState();
  }
  return _state;
}

// 60일 넘은 tombstone 제거. 그 시점이면 모든 기기가 삭제를 반영했다고 보고 영구 제거.
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
function gcTombstones() {
  if (!_state) return;
  const cutoff = now() - TOMBSTONE_TTL_MS;
  const live = x => !x.deletedAt || x.deletedAt > cutoff;
  _state.recipes = (_state.recipes || []).filter(live);
  _state.myDevices = (_state.myDevices || []).filter(live);
}

export function getState() { return _state || loadState(); }

// 샘플(시드) 데이터는 '진짜 첫 사용'에만 1회 주입. 데이터가 이미 있거나(삭제 tombstone 포함)
// 이미 시드한 적 있으면 건너뛴다. 로그인 사용자에겐 호출하지 않는다(클라우드가 진실원 →
// 기기 추가/저장소 초기화 때마다 샘플이 재유입되던 버그 방지). 반환: 시드했으면 true.
const SEEDED_KEY = 'airfryer-seeded';
export function seedIfNeeded() {
  const s = getState();
  const hasAny = (s.recipes && s.recipes.length) || (s.myDevices && s.myDevices.length);
  let seededBefore = false;
  try { seededBefore = !!localStorage.getItem(SEEDED_KEY); } catch (e) {}
  if (hasAny || seededBefore) return false;
  const seed = seedState();
  s.myDevices = seed.myDevices;
  s.recipes = seed.recipes;
  try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) {}
  persist();
  return true;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch (e) {
    console.error('저장 실패 (용량 초과 가능)', e);
    return false;
  }
  return true;
}

// 동기화 훅: 로컬 변경 시 호출(원격 적용 중엔 억제해 루프 방지)
let _commitHook = null;
let _suppressHook = false;
export function setCommitHook(fn) { _commitHook = fn; }

// 변경 후 호출: 저장 + 변경 카운트 증가(백업 넛지용) + 동기화 푸시
function commit() {
  _state.settings.changeCount = (_state.settings.changeCount || 0) + 1;
  const ok = persist();
  if (_commitHook && !_suppressHook) _commitHook(getFullData());
  return ok;
}

// 동기화용 전체 스냅샷
export function getFullData() {
  const s = getState();
  return { schemaVersion: s.schemaVersion, myDevices: s.myDevices, recipes: s.recipes, settings: s.settings };
}

// ---------------------------------------------------------------------------
// 동기화 머지 (per-item updatedAt LWW + tombstone + successLog union)
// ---------------------------------------------------------------------------
// 두 항목 목록을 id 기준으로 머지. 같은 id는 updatedAt이 큰 쪽이 이김(동률 시 로컬).
// tombstone(deletedAt)도 보통 항목처럼 updatedAt으로 경쟁 → 삭제가 최신이면 삭제 유지.
function mergeItems(local, remote) {
  const m = new Map();
  for (const x of remote) m.set(x.id, x);
  for (const x of local) {
    const r = m.get(x.id);
    m.set(x.id, r ? mergeOne(x, r) : x);
  }
  return [...m.values()];
}
// a=로컬, b=원격. 스칼라 필드는 승자 채택, successLog는 양쪽 union(유실 방지).
function mergeOne(a, b) {
  const winner = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const hasLog = Array.isArray(a.successLog) || Array.isArray(b.successLog);
  if (!hasLog) return winner;
  return Object.assign({}, winner, { successLog: unionLog(a.successLog, b.successLog) });
}
function unionLog(a, b) {
  const m = new Map();
  (Array.isArray(b) ? b : []).forEach(e => e && e.id && m.set(e.id, e));
  (Array.isArray(a) ? a : []).forEach(e => e && e.id && m.set(e.id, e));  // 로컬 우선
  return [...m.values()];
}
// id 정렬 후 직렬화 — 순서 무관 동등성 비교용(변경/푸시 필요 판단).
function canonState(st) {
  const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
  const recipes = [...(st.recipes || [])].sort(byId).map(r =>
    Object.assign({}, r, { successLog: [...(r.successLog || [])].sort(byId) }));
  const myDevices = [...(st.myDevices || [])].sort(byId);
  return JSON.stringify({ recipes, myDevices });
}

// 순수 머지 코어(테스트 가능, _state 비의존). local/remote: 정규화된 상태.
// 반환: { recipes, myDevices, lastUsed, changed, pushNeeded }
export function mergeCore(local, remote) {
  const before = canonState(local);
  const recipes = mergeItems(local.recipes || [], remote.recipes || []);
  const myDevices = mergeItems(local.myDevices || [], remote.myDevices || []);
  const lastUsed = Object.assign({},
    (remote.settings && remote.settings.lastUsed) || {},
    (local.settings && local.settings.lastUsed) || {});
  const merged = { recipes, myDevices };
  const after = canonState(merged);
  return {
    recipes, myDevices, lastUsed,
    changed: after !== before,
    pushNeeded: after !== canonState(remote),
  };
}

// 원격 데이터를 로컬에 머지(최초 로그인 + 이후 onSnapshot 공용). 푸시 억제.
// 반환: { changed: 로컬이 바뀌었나(→UI 갱신), pushNeeded: 머지결과가 원격과 다른가(→수렴 푸시) }
export function mergeRemote(data) {
  const remote = migrate(data);
  const s = getState();
  const res = mergeCore(s, remote);

  _suppressHook = true;
  s.recipes = res.recipes;
  s.myDevices = res.myDevices;
  s.settings.lastUsed = res.lastUsed;   // lastBackupAt/changeCount는 기기 로컬값 유지
  persist();
  _suppressHook = false;

  return { changed: res.changed, pushNeeded: res.pushNeeded };
}

// 영속 권한 요청 (iOS/브라우저 저장소 삭제 완화)
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* noop */ }
  return false;
}

// ---------------------------------------------------------------------------
// 기기 CRUD
// ---------------------------------------------------------------------------
// UI/로직용 게터는 tombstone을 숨긴다. _state.myDevices엔 동기화 위해 그대로 남김.
export function getDevices() { return getState().myDevices.filter(d => !d.deletedAt); }
export function getDevice(id) {
  const d = getState().myDevices.find(d => d.id === id);
  return d && !d.deletedAt ? d : null;
}

export function saveDevice(input) {
  const s = getState();
  const stamped = Object.assign({}, input, { updatedAt: now(), deletedAt: null });
  if (input.id) {
    const i = s.myDevices.findIndex(d => d.id === input.id);
    if (i >= 0) s.myDevices[i] = normalizeDevice(Object.assign({}, s.myDevices[i], stamped));
    else s.myDevices.push(normalizeDevice(stamped));
  } else {
    s.myDevices.push(normalizeDevice(Object.assign({ id: uid() }, stamped)));
  }
  commit();
  return s.myDevices;
}

// 기기 삭제: 참조하는 (살아있는) 레시피가 있으면 막는다 (dangling 방지)
export function deleteDevice(id) {
  const s = getState();
  const used = getRecipes().filter(r => r.baseDeviceId === id);
  if (used.length > 0) {
    return { ok: false, usedBy: used.map(r => r.name) };
  }
  const d = s.myDevices.find(d => d.id === id);
  if (d) { d.deletedAt = now(); d.updatedAt = now(); }  // tombstone (동기화 전파용)
  commit();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 레시피 CRUD
// ---------------------------------------------------------------------------
export function getRecipes() { return getState().recipes.filter(r => !r.deletedAt); }
export function getRecipe(id) {
  const r = getState().recipes.find(r => r.id === id);
  return r && !r.deletedAt ? r : null;
}

export function saveRecipe(input) {
  const s = getState();
  const stamped = Object.assign({}, input, { updatedAt: now(), deletedAt: null });
  if (input.id) {
    const i = s.recipes.findIndex(r => r.id === input.id);
    if (i >= 0) s.recipes[i] = normalizeRecipe(Object.assign({}, s.recipes[i], stamped));
    else s.recipes.push(normalizeRecipe(stamped));
  } else {
    s.recipes.push(normalizeRecipe(Object.assign({ id: uid() }, stamped)));
  }
  commit();
  return s.recipes;
}

// 삭제: 배열에서 빼지 않고 tombstone 표식 → 다른 기기에서 부활 방지
export function deleteRecipe(id) {
  const s = getState();
  const r = s.recipes.find(r => r.id === id);
  if (r) { r.deletedAt = now(); r.updatedAt = now(); }
  delete s.settings.lastUsed[id];
  commit();
}

// 삭제 실행취소용: tombstone이면 되살리고, 없으면 복원
export function restoreRecipe(obj) {
  if (!obj) return;
  const s = getState();
  const existing = s.recipes.find(r => r.id === obj.id);
  if (existing) {
    existing.deletedAt = null;
    existing.updatedAt = now();
  } else {
    s.recipes.push(normalizeRecipe(Object.assign({}, obj, { deletedAt: null, updatedAt: now() })));
  }
  commit();
}

export function duplicateRecipe(id) {
  const s = getState();
  const r = getRecipe(id);
  if (!r) return null;
  const copy = normalizeRecipe(Object.assign({}, r, {
    id: uid(),
    updatedAt: now(),
    deletedAt: null,
    name: r.name + ' (복사본)',
    successLog: [],   // 복제본은 기록 초기화
    favorite: false,
  }));
  s.recipes.push(copy);
  commit();
  return copy;
}

export function toggleFavorite(id) {
  const r = getRecipe(id);
  if (r) { r.favorite = !r.favorite; r.updatedAt = now(); commit(); }
  return r;
}

// 성공기록 추가 (닫힌 학습 루프의 입력)
export function addSuccessLog(recipeId, entry) {
  const r = getRecipe(recipeId);
  if (!r) return;
  r.successLog.push(Object.assign({
    id: uid(),   // 머지 union 키
    deviceId: null, actualTemp: null, actualTime: null, actualAmount: null,
    coreTemp: null, result: 'good', nextAdjust: null, date: new Date().toISOString(),
  }, entry));
  r.updatedAt = now();
  commit();
}

// ---------------------------------------------------------------------------
// 마지막 사용값 기억 (기기·양 프리셋)
// ---------------------------------------------------------------------------
export function rememberLastUsed(recipeId, deviceId, amount) {
  getState().settings.lastUsed[recipeId] = { deviceId, amount };
  persist();
}
export function getLastUsed(recipeId) {
  return getState().settings.lastUsed[recipeId] || null;
}

// ---------------------------------------------------------------------------
// 백업 (export / import)
// ---------------------------------------------------------------------------
export function exportData() {
  const s = getState();
  return JSON.stringify({
    schemaVersion: s.schemaVersion,
    exportedAt: new Date().toISOString(),
    myDevices: s.myDevices.filter(d => !d.deletedAt),  // 백업엔 tombstone 제외
    recipes: s.recipes.filter(r => !r.deletedAt),
    settings: s.settings,
  }, null, 2);
}

export function markBackupDone() {
  const s = getState();
  s.settings.lastBackupAt = new Date().toISOString();
  s.settings.changeCount = 0;
  persist();
}

// import 검증: 깨진/이상한 파일 거부. 통과 시 마이그레이션된 데이터 반환.
export function validateImport(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { return { ok: false, error: 'JSON 형식이 아닙니다.' }; }
  if (!data || typeof data !== 'object') return { ok: false, error: '데이터 구조가 올바르지 않습니다.' };
  if (!Array.isArray(data.recipes) && !Array.isArray(data.myDevices)) {
    return { ok: false, error: '레시피/기기 목록을 찾을 수 없습니다.' };
  }
  const migrated = migrate(data);
  return {
    ok: true,
    data: migrated,
    counts: { devices: migrated.myDevices.length, recipes: migrated.recipes.length },
  };
}

// import 적용. mode: 'replace'(덮어쓰기) | 'merge'(병합).
// 적용 전 현재 데이터를 백업 문자열로 반환(되돌리기용).
export function applyImport(migrated, mode) {
  const s = getState();
  const backup = exportData(); // 되돌리기용 현재 스냅샷

  if (mode === 'replace') {
    s.myDevices = migrated.myDevices;
    s.recipes = migrated.recipes;
    s.settings = Object.assign({ lastBackupAt: null, changeCount: 0, lastUsed: {} }, migrated.settings || {});
  } else { // merge: id 충돌 시 기존 유지(skip)
    const devIds = new Set(s.myDevices.map(d => d.id));
    migrated.myDevices.forEach(d => { if (!devIds.has(d.id)) s.myDevices.push(d); });
    const recIds = new Set(s.recipes.map(r => r.id));
    migrated.recipes.forEach(r => { if (!recIds.has(r.id)) s.recipes.push(r); });
  }
  commit();
  return backup;
}

// 되돌리기: applyImport가 반환한 백업 문자열로 복원
export function restoreFrom(backupText) {
  try {
    _state = migrate(JSON.parse(backupText));
    persist();
    return true;
  } catch (e) { return false; }
}
