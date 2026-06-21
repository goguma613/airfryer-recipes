// app.js — 컨트롤러: 네비게이션, 이벤트 배선, 타이머 통합.
import * as store from './store.js';
import * as ui from './ui.js';
import * as sync from './sync.js';
import { adjust, suggestFromHistory, extractFromText } from './calc.js';
import { CookTimer, fmtTime, beep } from './timer.js';

const view = document.getElementById('view');
const tabsEl = document.getElementById('tabs');
const nudgeEl = document.getElementById('nudge');

let nav = { screen: 'home', id: null };
let homeQuery = '';
let cook = { recipeId: null, deviceId: null, amount: null, result: null, temp: null, time: null };
let timer = null;
let persisted = false;
let lastImportBackup = null;
let syncUser = null;
let syncStatus = sync.isConfigured() ? 'ready' : 'unconfigured';

// --------------------------------------------------------------------------
// 부팅
// --------------------------------------------------------------------------
async function boot() {
  store.loadState();
  persisted = await checkPersisted();
  // 데이터가 있으면 영속 권한 시도(사용자 제스처 없이도 일부 브라우저 허용)
  store.requestPersist().then(p => { if (p) persisted = true; });
  bindEvents();

  // 동기화: 로컬 변경 → 푸시. 로그인/원격변경 → 로컬 반영.
  store.setCommitHook((data) => sync.pushData(data));
  sync.initSync({
    onUser: (user) => {
      syncUser = user;
      if (user) ui.toast(`${user.displayName || user.email}(으)로 동기화 켜짐`, 'ok');
      else maybeSeedLocal();   // 비로그인 → 로컬 온보딩 샘플(최초 1회)
      if (nav.screen === 'settings') render();
    },
    onInitialRemote: (data) => { const r = store.mergeRemote(data); if (r.changed) refreshIfVisible(); },
    onAfterInitial: () => sync.pushData(store.getFullData()),
    onRemoteData: (data) => handleRemote(data),
    onStatus: (status) => {
      syncStatus = status;
      if (status === 'offline' || status === 'unconfigured') maybeSeedLocal();  // 클라우드 못 쓰는 신규 → 로컬 시드
      if (nav.screen === 'settings') render();
    },
  });

  go('home');
}

// 샘플 시드: 로그인 안 한 신규 사용자에게만 최초 1회. 로그인 상태면 클라우드가 진실원이라
// 시드하지 않는다(샘플이 기기마다·초기화마다 재유입되던 버그 방지).
let triedSeed = false;
function maybeSeedLocal() {
  if (triedSeed || syncUser) return;
  triedSeed = true;
  if (store.seedIfNeeded() && nav.screen === 'home') render();
}

// 입력이 있는 화면(편집/조리)에선 원격 변경을 즉시 적용하면 미저장 입력이 날아간다.
// → 바로 머지하지 말고 버퍼링하고 "새로고침" 배너만 띄운다. 안전한 화면에선 즉시 머지.
const BUSY_SCREENS = ['edit', 'deviceForm', 'cook', 'cookmode', 'result'];
let pendingRemote = null;

function isBusyScreen() { return BUSY_SCREENS.includes(nav.screen); }

function handleRemote(data) {
  if (isBusyScreen()) { pendingRemote = data; showSyncBanner(); return; }
  applyRemoteMerge(data);
}

// 머지 후: 원격과 달라졌으면(우리만 가진 항목 등) 수렴 위해 푸시. 로컬이 바뀌었으면 다시 그림.
function applyRemoteMerge(data) {
  const r = store.mergeRemote(data);
  if (r.pushNeeded) sync.pushData(store.getFullData());
  if (r.changed) refreshIfVisible();
}

// 버퍼된 원격 변경을 적용(배너 새로고침 버튼 / 안전 화면 진입 시)
function flushPendingRemote() {
  if (!pendingRemote) return;
  const data = pendingRemote;
  pendingRemote = null;
  hideSyncBanner();
  applyRemoteMerge(data);
}

function showSyncBanner() {
  const el = document.getElementById('sync-banner');
  if (!el) return;
  el.innerHTML = `🔄 다른 기기에서 변경된 내용이 있어요 <button data-action="sync-refresh">새로고침</button>`;
  el.hidden = false;
}
function hideSyncBanner() {
  const el = document.getElementById('sync-banner');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

// 원격 변경이 들어오면 현재 보던 화면을 다시 그림(편집/조리 중엔 방해 안 함)
function refreshIfVisible() {
  if (['home', 'detail', 'devices', 'settings'].includes(nav.screen)) render();
}

async function checkPersisted() {
  try { if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted(); }
  catch (e) {}
  return false;
}

// --------------------------------------------------------------------------
// 네비게이션 / 렌더
// --------------------------------------------------------------------------
function go(screen, id = null) {
  nav = { screen, id };
  render();
  window.scrollTo(0, 0);
  // 안전한 화면으로 빠져나왔으면 버퍼된 원격 변경을 적용
  if (!isBusyScreen()) flushPendingRemote();
}

function render() {
  const inCookMode = nav.screen === 'cookmode' || nav.screen === 'result';
  document.body.classList.toggle('cookmode-on', inCookMode);
  tabsEl.style.display = inCookMode ? 'none' : '';
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.style.display = inCookMode ? 'none' : '';

  switch (nav.screen) {
    case 'home':
      view.innerHTML = ui.renderHome(store.getRecipes(), homeQuery);
      restoreSearchFocus();
      break;
    case 'detail': {
      const r = store.getRecipe(nav.id);
      view.innerHTML = ui.renderDetail(r, r && store.getDevice(r.baseDeviceId));
      break;
    }
    case 'cook':
      renderCook();
      break;
    case 'cookmode': {
      const r = store.getRecipe(cook.recipeId);
      view.innerHTML = ui.renderCookMode(r, timer ? fmtTime(timer.remaining) : '00:00', '');
      break;
    }
    case 'result': {
      const r = store.getRecipe(cook.recipeId);
      view.innerHTML = ui.renderResultPrompt(r);
      break;
    }
    case 'edit':
      view.innerHTML = ui.renderEdit(nav.id ? store.getRecipe(nav.id) : null, store.getDevices());
      break;
    case 'devices':
      view.innerHTML = ui.renderDevices(store.getDevices());
      break;
    case 'deviceForm':
      view.innerHTML = ui.renderDeviceForm(nav.id ? store.getDevice(nav.id) : null);
      break;
    case 'settings':
      view.innerHTML = ui.renderSettings(store.getState().settings, persisted, {
        configured: sync.isConfigured(), user: syncUser, status: syncStatus,
      });
      break;
  }
  updateTabs();
  updateNudge();
}

function updateTabs() {
  const map = { home: 'home', edit: 'add', settings: 'settings', devices: 'settings', deviceForm: 'settings' };
  const active = map[nav.screen] || '';
  tabsEl.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === active));
}

function updateNudge() {
  if (nav.screen === 'home') {
    nudgeEl.innerHTML = ui.backupNudge(store.getState().settings, !!syncUser);
  } else {
    nudgeEl.innerHTML = '';
  }
}

function restoreSearchFocus() {
  if (document.activeElement && document.activeElement.id === 'search') return;
  const el = view.querySelector('#search');
  if (el && homeQuery) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// --------------------------------------------------------------------------
// 조리 화면
// --------------------------------------------------------------------------
function renderCook() {
  const r = store.getRecipe(cook.recipeId);
  if (!r) return go('home');
  const devices = store.getDevices();
  if (!cook.deviceId) {
    const last = store.getLastUsed(r.id);
    cook.deviceId = (last && last.deviceId) || r.baseDeviceId || (devices[0] && devices[0].id) || null;
    cook.amount = (last && last.amount) || r.baseAmount || null;
  }
  const result = computeResult(r, cook.deviceId, cook.amount);
  cook.result = result;
  const suggestion = suggestFromHistory(r, cook.deviceId);
  view.innerHTML = ui.renderCook(r, devices, cook.deviceId, cook.amount, result, suggestion);
}

function computeResult(r, deviceId, amount) {
  const baseDev = store.getDevice(r.baseDeviceId);
  const target = store.getDevice(deviceId) || {};
  return adjust({
    baseTemp: r.baseTemp, baseTime: r.baseTime, baseAmount: r.baseAmount,
    baseWattage: baseDev && baseDev.wattage, source: r.source, startState: r.startState,
  }, target, amount);
}

// --------------------------------------------------------------------------
// 이벤트 배선 (위임)
// --------------------------------------------------------------------------
function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
}

function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const id = t.dataset.id;
  const action = t.dataset.action;

  switch (action) {
    // 탭
    case 'tab-home': go('home'); break;
    case 'tab-add': go('edit'); break;
    case 'tab-settings': go('settings'); break;

    case 'go-add': go('edit'); break;
    case 'go-settings': go('settings'); break;
    case 'go-devices': go('devices'); break;

    // 목록/상세
    case 'open': go('detail', id); break;
    case 'fav': store.toggleFavorite(id); render(); break;
    case 'edit': go('edit', id); break;
    case 'dup': { const c = store.duplicateRecipe(id); if (c) go('detail', c.id); break; }
    case 'del': confirmDelete(id); break;

    // 조리
    case 'cook': cook = { recipeId: id, deviceId: null, amount: null }; go('cook'); break;
    case 'back-detail': go('detail', id); break;
    case 'use-suggest': useSuggestion(); break;
    case 'start-timer': startTimer(id); break;

    // Cook Mode
    case 'cm-pause': togglePause(t); break;
    case 'cm-add': if (timer) timer.addSeconds(Number(t.dataset.sec) || 60); break;
    case 'cm-stop': confirmStop(); break;

    // 결과 기록
    case 'result': saveResult(id, t.dataset.result); break;
    case 'skip-result': go('detail', cook.recipeId); break;

    // 편집
    case 'extract': doExtract(); break;
    case 'save-recipe': saveRecipe(); break;
    case 'cancel-edit': nav.id ? go('detail', nav.id) : go('home'); break;

    // 기기
    case 'dev-add': go('deviceForm'); break;
    case 'dev-edit': go('deviceForm', id); break;
    case 'dev-del': deleteDevice(id); break;
    case 'save-device': saveDevice(); break;
    case 'cancel-device': go('devices'); break;

    // 설정/백업
    case 'export': doExport(); break;
    case 'import-pick': document.getElementById('import-file').click(); break;
    case 'req-persist': reqPersist(); break;
    case 'sign-in': sync.signIn(); break;
    case 'sign-out': signOut(); break;
    case 'sync-refresh': flushPendingRemote(); render(); break;
  }
}

function onInput(e) {
  if (e.target.id === 'search') {
    homeQuery = e.target.value;
    view.innerHTML = ui.renderHome(store.getRecipes(), homeQuery);
    const el = view.querySelector('#search');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}

function onChange(e) {
  if (e.target.id === 'cook-device') { cook.deviceId = e.target.value; renderCook(); }
  if (e.target.id === 'cook-amount') { cook.amount = e.target.value ? Number(e.target.value) : null; renderCook(); }
  if (e.target.id === 'import-file') { handleImportFile(e.target.files[0]); e.target.value = ''; }
}

// --------------------------------------------------------------------------
// 조리/타이머 액션
// --------------------------------------------------------------------------
function useSuggestion() {
  const r = store.getRecipe(cook.recipeId);
  const s = suggestFromHistory(r, cook.deviceId);
  if (!s) return;
  // 제안값을 그대로 타이머에 사용
  cook.result = { temp: s.temp, timeMin: s.time, timeMax: s.time, notes: [], unreliable: false };
  cook.temp = s.temp; cook.time = s.time;
  startTimerWith(r, s.temp, s.time);
}

function startTimer(id) {
  const r = store.getRecipe(id);
  if (!r) return;
  const res = cook.result || computeResult(r, cook.deviceId, cook.amount);
  startTimerWith(r, res.temp, res.timeMin);
}

function startTimerWith(r, temp, minutes) {
  cook.temp = temp;
  cook.time = minutes;
  store.rememberLastUsed(r.id, cook.deviceId, cook.amount);

  // 화면 진입(오디오 컨텍스트 활성화를 위해 사용자 제스처 내에서 beep 준비)
  beep(0);
  go('cookmode');

  timer = new CookTimer({
    totalSec: minutes * 60,
    steps: r.flip ? r.steps : [],
    onTick: (rem) => { const el = document.getElementById('cm-time'); if (el) el.textContent = fmtTime(rem); },
    onStep: (s) => { const el = document.getElementById('cm-step'); if (el) el.textContent = `🔔 ${s.label}`; },
    onDone: () => { go('result'); },
  });
  timer.start();
}

function togglePause(btn) {
  if (!timer) return;
  if (timer.running) { timer.pause(); btn.textContent = '계속'; }
  else { timer.resume(); btn.textContent = '일시정지'; }
}

async function confirmDelete(id) {
  const ok = await ui.confirmSheet({ title: '레시피 삭제', message: '이 레시피를 삭제할까요?', okText: '삭제', danger: true });
  if (!ok) return;
  const snapshot = JSON.parse(JSON.stringify(store.getRecipe(id)));
  store.deleteRecipe(id);
  go('home');
  ui.toastUndo('레시피를 삭제했어요', () => { store.restoreRecipe(snapshot); go('detail', snapshot.id); });
}

async function confirmStop() {
  const ok = await ui.confirmSheet({ title: '타이머 정지', message: '타이머를 정지하고 결과를 기록할까요?', okText: '정지', danger: true });
  if (!ok) return;
  if (timer) timer.stop();
  go('result');
}

function saveResult(id, result) {
  const adjEl = document.getElementById('result-adjust');
  const coreEl = document.getElementById('result-core');
  const adj = adjEl && adjEl.value ? Number(adjEl.value) : 0;
  store.addSuccessLog(id, {
    deviceId: cook.deviceId,
    actualTemp: cook.temp,
    actualTime: cook.time || null,       // 실제 사용한 시간(정직)
    actualAmount: cook.amount,
    coreTemp: coreEl && coreEl.value ? Number(coreEl.value) : null,
    result,
    nextAdjust: Number.isFinite(adj) && adj !== 0 ? adj : null,  // 다음 추천 보정값(학습 입력)
  });
  timer = null;
  // 학습 루프 가시화: 무엇을 배웠는지 알려준다
  const msg = result === 'undercooked' ? '기록했어요. 다음엔 시간을 더 늘려 추천할게요'
    : result === 'burnt' ? '기록했어요. 다음엔 시간을 줄여 추천할게요'
    : '기록했어요. 다음에 이 값을 추천할게요 👍';
  ui.toast(msg, 'ok');
  go('detail', id);
}

// --------------------------------------------------------------------------
// 편집 저장
// --------------------------------------------------------------------------
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function num(id) { const v = val(id); return v === '' ? null : Number(v); }
function chk(id) { const el = document.getElementById(id); return el ? el.checked : false; }

function doExtract() {
  const { temp, time } = extractFromText(val('f-paste'));
  if (temp != null) document.getElementById('f-temp').value = temp;
  if (time != null) document.getElementById('f-time').value = time;
  if (temp == null && time == null) ui.toast('온도·시간을 찾지 못했어요. 직접 입력해주세요.', 'risk');
  else ui.toast('자동으로 채웠어요. 확인해주세요.', 'ok');
}

function parseSteps(text) {
  return (text || '').split('\n').map(line => {
    const [m, ...rest] = line.split(',');
    const atMin = Number((m || '').trim());
    const label = rest.join(',').trim();
    return Number.isFinite(atMin) && label ? { atMin, label } : null;
  }).filter(Boolean);
}

function saveRecipe() {
  const name = val('f-name'), temp = num('f-temp'), time = num('f-time');
  if (!name || temp == null || time == null) {
    ui.toast('이름·온도·시간은 필수예요.', 'risk');
    ['f-name', 'f-temp', 'f-time'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.setAttribute('aria-invalid', String(!el.value.trim()));
    });
    return;
  }
  const input = {
    id: val('f-id') || undefined,
    name, baseTemp: temp, baseTime: time,
    category: val('f-cat') || '기타',
    baseAmount: num('f-amount'),
    source: val('f-src') || 'manual',
    startState: val('f-state') || 'room',
    baseDeviceId: val('f-device') || null,
    riskFood: chk('f-risk'),
    targetCoreTemp: num('f-core'),
    flip: chk('f-flip'),
    steps: parseSteps(val('f-steps')),
    memo: val('f-memo'),
  };
  const saved = store.saveRecipe(input);
  const id = input.id || saved[saved.length - 1].id;
  go('detail', id);
}

// --------------------------------------------------------------------------
// 기기
// --------------------------------------------------------------------------
function saveDevice() {
  const name = val('d-name'), watt = num('d-watt');
  if (!name || watt == null) { ui.toast('이름·출력(W)은 필수예요.', 'risk'); return; }
  store.saveDevice({
    id: val('d-id') || undefined,
    name, wattage: watt,
    type: val('d-type') || 'basket',
    capacity: num('d-cap'),
    preheat: chk('d-preheat'),
    memo: val('d-memo'),
  });
  go('devices');
}

function deleteDevice(id) {
  const res = store.deleteDevice(id);
  if (!res.ok) {
    ui.toast(`이 기기를 쓰는 레시피가 있어 삭제할 수 없어요: ${res.usedBy.join(', ')}`, 'risk');
    return;
  }
  go('devices');
  ui.toast('기기를 삭제했어요', 'ok');
}

// --------------------------------------------------------------------------
// 백업 export / import
// --------------------------------------------------------------------------
function doExport() {
  const data = store.exportData();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const name = `recipes-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-v${store.SCHEMA_VERSION}.json`;
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  store.markBackupDone();
  render();
  ui.toast('백업 파일을 내보냈어요', 'ok');
}

function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const res = store.validateImport(String(reader.result));
    if (!res.ok) { ui.toast('가져오기 실패: ' + res.error, 'risk'); return; }
    const replace = await ui.confirmSheet({
      title: '데이터 가져오기',
      message: `기기 ${res.counts.devices}개, 레시피 ${res.counts.recipes}개를 가져옵니다. 전체 덮어쓸까요? (취소 시 기존과 병합)`,
      okText: '덮어쓰기', cancelText: '병합',
    });
    const backup = store.applyImport(res.data, replace ? 'replace' : 'merge');
    go('home');
    ui.toastUndo('가져왔어요', () => { if (store.restoreFrom(backup)) go('home'); });
  };
  reader.readAsText(file);
}

async function signOut() {
  const ok = await ui.confirmSheet({ title: '로그아웃', message: '동기화를 끄고 로그아웃할까요? 데이터는 이 기기에 그대로 남아요.', okText: '로그아웃' });
  if (!ok) return;
  await sync.signOutUser();
  syncUser = null;
  ui.toast('로그아웃했어요', 'ok');
  render();
}

async function reqPersist() {
  const ok = await store.requestPersist();
  persisted = ok || await checkPersisted();
  ui.toast(persisted ? '저장 영속 권한이 허용됐어요' : '권한이 거부됐어요. 주기적 백업을 권장해요', persisted ? 'ok' : 'risk');
  render();
}

boot();
