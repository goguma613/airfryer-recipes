// ui.js — 렌더링(HTML 문자열 생성). 사용자 입력은 esc()로 XSS 방지.
// 순수 표현 계층: 이벤트 배선은 app.js가 담당(data-action 속성 사용).

// ---- XSS 방지 ----
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- 라벨 ----
export const CATEGORIES = ['냉동식품', '육류', '베이커리', '채소', '해산물', '기타'];
export const SOURCE_LABEL = { manual: '직접입력', package: '제품봉지', official: '공식매뉴얼', oven: '오븐레시피', experience: '내경험' };
export const STATE_LABEL = { frozen: '냉동', chilled: '냉장', room: '실온' };
export const TYPE_LABEL = { basket: '바스켓형', oven: '오븐형', lid: '뚜껑형' };
export const RESULT_LABEL = { good: '👍 딱좋음', undercooked: '🥶 덜익음', burnt: '🔥 탐' };
const RISK_CATS = new Set(['육류', '해산물']);

// ---------------------------------------------------------------------------
// 홈 (레시피 목록)
// ---------------------------------------------------------------------------
export function renderHome(recipes, query) {
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? recipes.filter(r => r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q))
    : recipes;

  const favs = filtered.filter(r => r.favorite);
  const recent = filtered.filter(r => !r.favorite).slice(0, 4);

  let html = `
    <div class="search-bar">
      <input id="search" type="search" inputmode="search" placeholder="레시피 검색…" value="${esc(query || '')}" aria-label="레시피 검색">
    </div>`;

  if (recipes.length === 0) {
    return html + emptyHome();
  }

  if (!q && favs.length) {
    html += `<h2 class="section-title">⭐ 즐겨찾기</h2><div class="card-grid">${favs.map(card).join('')}</div>`;
  }
  if (!q && recent.length) {
    html += `<h2 class="section-title">최근/대표</h2><div class="card-grid">${recent.map(card).join('')}</div>`;
  }
  if (q) {
    html += filtered.length
      ? `<div class="card-grid">${filtered.map(card).join('')}</div>`
      : `<p class="muted center">"${esc(query)}"에 맞는 레시피가 없어요.</p>`;
  } else {
    const rest = filtered.filter(r => !r.favorite).slice(4);
    if (rest.length) html += `<h2 class="section-title">전체</h2><div class="card-grid">${rest.map(card).join('')}</div>`;
  }
  return html;
}

function emptyHome() {
  return `
    <div class="empty">
      <div class="empty-emoji">🍟</div>
      <h2>첫 레시피를 추가해보세요</h2>
      <p class="muted">제품 봉지의 온도·시간을 적어두면, 다음엔 내 기기·양에 맞춰 알아서 보정해줘요.</p>
      <button class="btn primary big" data-action="go-add">+ 레시피 추가</button>
    </div>`;
}

function card(r) {
  return `
    <div class="card-wrap">
      <button class="card${r.riskFood ? ' card--risk' : ''}" data-action="open" data-id="${esc(r.id)}">
        <div class="card__head"><span class="card__cat">${esc(r.category)}</span></div>
        <div class="card__name">${esc(r.name)}</div>
        <div class="card__spec">
          <span class="card__temp">${esc(r.baseTemp ?? '?')}<small>℃</small></span>
          <span class="card__dot">·</span>
          <span class="card__time">${esc(r.baseTime ?? '?')}<small>분</small></span>
        </div>
      </button>
      <button class="card__fav${r.favorite ? ' is-on' : ''}" data-action="fav" data-id="${esc(r.id)}" aria-label="즐겨찾기" aria-pressed="${!!r.favorite}">${r.favorite ? '★' : '☆'}</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 레시피 상세
// ---------------------------------------------------------------------------
export function renderDetail(r, baseDevice) {
  if (!r) return `<p class="muted center">레시피를 찾을 수 없습니다.</p>`;
  const steps = r.steps.length
    ? `<ul class="steps">${r.steps.map(s => `<li><b>${esc(s.atMin)}분</b> 후 — ${esc(s.label)}</li>`).join('')}</ul>`
    : '<p class="muted">단계 알림 없음</p>';

  const riskBox = r.riskFood ? `
    <div class="warn">
      ⚠️ <b>위험식품</b> — 시간은 보조입니다. <b>심부 온도계로 중심온도 ${esc(r.targetCoreTemp || 74)}℃</b>를 확인하세요.
      ${r.startState === 'frozen' ? '<br>냉동 상태는 속까지 익는 데 시간이 더 걸립니다.' : ''}
    </div>` : '';

  const log = renderLog(r.successLog);

  return `
    <div class="detail">
      <div class="detail-head">
        <h1>${esc(r.name)}</h1>
        <button class="icon-btn" data-action="fav" data-id="${esc(r.id)}" aria-label="즐겨찾기" aria-pressed="${!!r.favorite}">${r.favorite ? '★' : '☆'}</button>
      </div>
      <div class="chips">
        <span class="badge">${esc(r.category)}</span>
        <span class="badge">${esc(SOURCE_LABEL[r.source] || r.source)}</span>
        <span class="badge">${esc(STATE_LABEL[r.startState] || r.startState)}</span>
      </div>
      <div class="hero-spec">
        <div><span>온도</span><b>${esc(r.baseTemp ?? '?')}<small>℃</small></b></div>
        <div><span>시간</span><b>${esc(r.baseTime ?? '?')}<small>분</small></b></div>
      </div>
      <p class="hero-sub">기준 양 ${r.baseAmount ? esc(r.baseAmount) + 'g' : '-'} · ${esc(baseDevice ? baseDevice.name : '기기 없음')}</p>
      ${riskBox}
      <div class="action-bar">
        <button class="btn primary big" data-action="cook" data-id="${esc(r.id)}">🔥 조리 시작</button>
      </div>
      <h2 class="section-title">단계</h2>
      ${steps}
      ${r.memo ? `<h2 class="section-title">메모</h2><p class="memo">${esc(r.memo)}</p>` : ''}
      <h2 class="section-title">조리 기록</h2>
      ${log}
      <div class="detail-manage">
        <button class="link-btn" data-action="edit" data-id="${esc(r.id)}">편집</button>
        <button class="link-btn" data-action="dup" data-id="${esc(r.id)}">복제</button>
        <button class="link-btn danger" data-action="del" data-id="${esc(r.id)}">삭제</button>
      </div>
    </div>`;
}

function renderLog(logs) {
  if (!logs || !logs.length) return '<p class="muted">아직 기록이 없어요. 조리 후 결과를 남기면 다음 추천이 정확해져요.</p>';
  return `<ul class="log">${logs.slice().reverse().map(l => `
    <li>
      <span>${esc(RESULT_LABEL[l.result] || l.result)}</span>
      <span class="muted">${esc(l.actualTemp ?? '?')}℃ · ${esc(l.actualTime ?? '?')}분${l.coreTemp ? ' · 중심 ' + esc(l.coreTemp) + '℃' : ''}</span>
      <span class="muted small">${esc((l.date || '').slice(0, 10))}</span>
    </li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// 조리 화면(보정 결과)
// ---------------------------------------------------------------------------
export function renderCook(r, devices, selectedDeviceId, amount, result, suggestion, opts = {}) {
  const devOpts = devices.map(d =>
    `<option value="${esc(d.id)}" ${d.id === selectedDeviceId ? 'selected' : ''}>${esc(d.name)} (${esc(d.wattage || '?')}W)</option>`
  ).join('');

  const sugg = suggestion ? `
    <div class="suggest">
      💡 ${esc(suggestion.reason || '지난 기록 기반')}: <b>${esc(suggestion.temp)}℃ · ${esc(suggestion.time)}분</b>
      <button class="btn small" data-action="use-suggest">이 값 쓰기</button>
    </div>` : '';

  const sel = devices.find(d => d.id === selectedDeviceId);
  const deviceName = sel ? sel.name : '선택한 기기';
  const baseLine = `원본 ${esc(r.baseTemp ?? '?')}℃ · ${esc(r.baseTime ?? '?')}분${r.baseAmount ? ` · ${esc(r.baseAmount)}g` : ''}`;
  const why = result.notes.length
    ? `<div class="why"><div class="why-title">왜 이 값인가요?</div><ul>${result.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : `<p class="why-none">이 기기·이 양에는 추가 보정이 없어요. 구간은 안전 여유 ±15%입니다.</p>`;

  const riskBox = r.riskFood ? `
    <div class="warn">
      ⚠️ <b>중심온도 ${esc(r.targetCoreTemp || 74)}℃ 확인 필수.</b> 아래 시간은 시작점일 뿐, 속까지 익었는지로 판단하세요.
    </div>` : `<p class="muted small">아래 값은 추정 시작점입니다. 중간에 한 번 확인하세요.</p>`;

  return `
    <div class="cook">
      <button class="link-btn" data-action="back-detail" data-id="${esc(r.id)}">← ${esc(r.name)}</button>
      <div class="field">
        <label>어느 기기로?</label>
        <select id="cook-device">${devOpts || '<option>기기를 먼저 등록하세요</option>'}</select>
      </div>
      ${opts.useServings ? `
      <div class="field">
        <label>몇 인분?</label>
        <div class="servings">
          <button class="step-btn" data-action="serv-dec" aria-label="인분 줄이기">−</button>
          <span class="serv-val"><b>${esc(opts.servings)}</b>인분</span>
          <button class="step-btn" data-action="serv-inc" aria-label="인분 늘리기">＋</button>
          <span class="serv-grams">≈ ${esc(amount)}g</span>
        </div>
        ${opts.capacityWarn ? `<p class="warn-soft">⚠️ ${esc(opts.capacityWarn)}</p>` : ''}
      </div>` : `
      <div class="field">
        <label>양 (g) — 기준 ${esc(r.baseAmount || '?')}g</label>
        <input id="cook-amount" type="number" inputmode="numeric" value="${esc(amount ?? r.baseAmount ?? '')}" placeholder="${esc(r.baseAmount || '')}">
      </div>`}
      ${sugg}
      <div class="adjust-card">
        <div class="adjust-from">${baseLine}</div>
        <div class="adjust-to-label">↓ <b>${esc(deviceName)}</b> 기준으로 보정</div>
        <div class="result-big">
          <div class="result-temp">${esc(result.temp)}℃</div>
          <div class="result-time">${esc(result.timeMin)}~${esc(result.timeMax)}분</div>
        </div>
        ${why}
      </div>
      ${riskBox}
      <button class="btn primary big" data-action="start-timer" data-id="${esc(r.id)}">⏱ ${esc(Math.round((result.timeMin + result.timeMax) / 2))}분 타이머 시작</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Cook Mode (큰 타이머 전용 화면)
// ---------------------------------------------------------------------------
export function renderCookMode(r, timeStr, stepMsg) {
  return `
    <div class="cookmode">
      <div class="cm-name">${esc(r.name)}</div>
      <div class="cm-time" id="cm-time">${esc(timeStr)}</div>
      <div class="cm-step" id="cm-step">${esc(stepMsg || '')}</div>
      <div class="cm-controls">
        <button class="btn big" data-action="cm-add" data-sec="60">+1분</button>
        <button class="btn big" data-action="cm-pause" id="cm-pause">일시정지</button>
        <button class="btn big danger" data-action="cm-stop">정지</button>
      </div>
      ${r.riskFood ? `<div class="warn cm-warn">⚠️ 중심온도 ${esc(r.targetCoreTemp || 74)}℃ 확인 필수</div>` : ''}
    </div>`;
}

// 타이머 종료 후 결과 3택
export function renderResultPrompt(r, used = {}) {
  const core = esc(r.targetCoreTemp || 74);
  const cooked = (used.temp != null || used.time != null)
    ? `<p class="cooked-with">이번엔 <b>${esc(used.temp ?? '?')}℃ · ${esc(used.time ?? '?')}분</b>으로 구웠어요</p>` : '';
  const safety = r.riskFood ? `
    <div class="safety-gate">
      <div class="safety-title">🌡️ 먹기 전 안전 확인</div>
      <p>가장 두꺼운 부위를 온도계로 찔러 <b>중심온도 ${core}℃ 이상</b>인지 확인하세요. 덜 익었으면 다시 더 익히세요.</p>
      <p class="disclaimer">앱의 시간·온도는 <b>추정 가이드</b>예요. 익힘 판단은 반드시 실제 중심온도로 하세요.</p>
    </div>` : '';
  return `
    <div class="result-prompt">
      ${safety}
      <h2>${esc(r.name)} — 어땠어요?</h2>
      ${cooked}
      <div class="result-choices">
        <button class="btn choice" data-action="result" data-id="${esc(r.id)}" data-result="good"><span class="emoji">👍</span>딱좋음</button>
        <button class="btn choice" data-action="result" data-id="${esc(r.id)}" data-result="undercooked"><span class="emoji">🥶</span>덜익음</button>
        <button class="btn choice" data-action="result" data-id="${esc(r.id)}" data-result="burnt"><span class="emoji">🔥</span>탐</button>
      </div>
      <div class="field">
        <label>다음엔 시간 조정 (분, 선택)</label>
        <input id="result-adjust" type="number" inputmode="numeric" placeholder="예: +2 또는 -1">
      </div>
      ${r.riskFood ? `<div class="field"><label>실측 중심온도 (℃) — 안전 확인용</label><input id="result-core" type="number" inputmode="numeric" placeholder="예: 75"></div>` : ''}
      <button class="btn" data-action="skip-result">건너뛰기</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 레시피 추가/편집 폼 (Quick Add: 이름·온도·시간만 필수)
// ---------------------------------------------------------------------------
export function renderEdit(r, devices) {
  const isNew = !r;
  r = r || {};
  const opt = (val, cur) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>`;
  const devOpts = devices.map(d => `${opt(d.id, r.baseDeviceId)}${esc(d.name)}</option>`).join('');
  const catOpts = CATEGORIES.map(c => `${opt(c, r.category || '냉동식품')}${esc(c)}</option>`).join('');
  const srcOpts = Object.entries(SOURCE_LABEL).map(([k, v]) => `${opt(k, r.source || 'package')}${esc(v)}</option>`).join('');
  const stOpts = Object.entries(STATE_LABEL).map(([k, v]) => `${opt(k, r.startState || 'room')}${esc(v)}</option>`).join('');

  return `
    <div class="edit">
      <h1>${isNew ? '레시피 추가' : '레시피 편집'}</h1>
      <input type="hidden" id="f-id" value="${esc(r.id || '')}">

      <details class="paste-box">
        <summary>📋 봉지/사이트 텍스트 붙여넣기 → 자동 채우기</summary>
        <textarea id="f-paste" rows="3" placeholder="예) 에어프라이어 200도에서 12분간 조리하세요"></textarea>
        <button class="btn small" data-action="extract">온도·시간 추출</button>
      </details>

      <div class="field"><label>이름 *</label><input id="f-name" value="${esc(r.name || '')}" placeholder="예: 냉동 치킨너겟"></div>
      <div class="field-row">
        <div class="field"><label>온도(℃) *</label><input id="f-temp" type="number" inputmode="numeric" value="${esc(r.baseTemp ?? '')}"></div>
        <div class="field"><label>시간(분) *</label><input id="f-time" type="number" inputmode="numeric" value="${esc(r.baseTime ?? '')}"></div>
      </div>

      <details class="more">
        <summary>상세 옵션 (선택)</summary>
        <div class="field-row">
          <div class="field"><label>카테고리</label><select id="f-cat">${catOpts}</select></div>
          <div class="field"><label>기준 양(g)</label><input id="f-amount" type="number" inputmode="numeric" value="${esc(r.baseAmount ?? '')}"></div>
        </div>
        <div class="field"><label>1인분 기준량(g) <span class="muted small">— 넣으면 조리 화면에서 '인분'으로 물어봐요</span></label><input id="f-serving" type="number" inputmode="numeric" value="${esc(r.gramsPerServing ?? '')}" placeholder="예: 너겟 100, 만두 120"></div>
        <div class="field-row">
          <div class="field"><label>출처</label><select id="f-src">${srcOpts}</select></div>
          <div class="field"><label>시작 상태</label><select id="f-state">${stOpts}</select></div>
        </div>
        <div class="field"><label>기준 기기</label><select id="f-device">${devOpts || '<option value="">기기 없음</option>'}</select></div>
        <label class="check"><input id="f-risk" type="checkbox" ${r.riskFood ? 'checked' : ''}> 위험식품(닭·돼지·다짐육·생선·달걀) — 중심온도 확인 필요</label>
        <div class="field"><label>목표 중심온도(℃)</label><input id="f-core" type="number" inputmode="numeric" value="${esc(r.targetCoreTemp ?? '')}" placeholder="닭 74 / 다짐육 71 / 통살 63"></div>
        <label class="check"><input id="f-flip" type="checkbox" ${r.flip ?? true ? 'checked' : ''}> 중간에 뒤집기/흔들기</label>
        <div class="field"><label>단계 알림 (한 줄에 "분,내용")</label>
          <textarea id="f-steps" rows="2" placeholder="예)&#10;8,흔들기&#10;15,뒤집기">${esc((r.steps || []).map(s => `${s.atMin},${s.label}`).join('\n'))}</textarea></div>
        <div class="field"><label>메모</label><textarea id="f-memo" rows="2">${esc(r.memo || '')}</textarea></div>
      </details>

      <button class="btn primary big" data-action="save-recipe">저장</button>
      <button class="btn" data-action="cancel-edit">취소</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 기기 관리
// ---------------------------------------------------------------------------
export function renderDevices(devices) {
  const list = devices.length
    ? devices.map(d => `
        <div class="dev-item">
          <div><b>${esc(d.name)}</b> <span class="muted">${esc(TYPE_LABEL[d.type] || d.type)} · ${esc(d.wattage || '?')}W${d.capacity ? ' · ' + esc(d.capacity) + 'L' : ''}</span></div>
          <div class="row-btns">
            <button class="btn small" data-action="dev-edit" data-id="${esc(d.id)}">편집</button>
            <button class="btn small danger" data-action="dev-del" data-id="${esc(d.id)}">삭제</button>
          </div>
        </div>`).join('')
    : '<p class="muted">등록된 기기가 없어요.</p>';
  return `
    <div class="devices">
      <h1>내 기기</h1>
      ${list}
      <button class="btn primary" data-action="dev-add">+ 기기 추가</button>
    </div>`;
}

export function renderDeviceForm(d) {
  const isNew = !d; d = d || {};
  const tOpt = (k, v) => `<option value="${esc(k)}" ${k === (d.type || 'basket') ? 'selected' : ''}>${esc(v)}</option>`;
  return `
    <div class="dev-form">
      <h1>${isNew ? '기기 추가' : '기기 편집'}</h1>
      <input type="hidden" id="d-id" value="${esc(d.id || '')}">
      <div class="field"><label>이름 *</label><input id="d-name" value="${esc(d.name || '')}" placeholder="예: 필립스 XL"></div>
      <div class="field"><label>타입</label><select id="d-type">${Object.entries(TYPE_LABEL).map(([k, v]) => tOpt(k, v)).join('')}</select></div>
      <div class="field-row">
        <div class="field"><label>출력(W) *</label><input id="d-watt" type="number" inputmode="numeric" value="${esc(d.wattage ?? '')}" placeholder="예: 1500"></div>
        <div class="field"><label>용량(L)</label><input id="d-cap" type="number" inputmode="numeric" value="${esc(d.capacity ?? '')}"></div>
      </div>
      <label class="check"><input id="d-preheat" type="checkbox" ${d.preheat ? 'checked' : ''}> 예열 후 사용</label>
      <div class="field"><label>메모</label><textarea id="d-memo" rows="2">${esc(d.memo || '')}</textarea></div>
      <button class="btn primary big" data-action="save-device">저장</button>
      <button class="btn" data-action="cancel-device">취소</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const SYNC_LABEL = { ready: '대기', signing: '로그인 중…', syncing: '동기화 중…', synced: '동기화됨 ✓',
  offline: '오프라인', error: '오류', unconfigured: '미설정' };

export function renderSettings(settings, persisted, syncInfo) {
  const last = settings.lastBackupAt ? settings.lastBackupAt.slice(0, 10) : '없음';
  const needBackup = (settings.changeCount || 0) >= 5;
  const s = syncInfo || { configured: false };

  let syncBlock;
  if (!s.configured) {
    syncBlock = `<div class="info">클라우드 동기화가 아직 설정되지 않았어요. <code>firebase-config.js</code>에 Firebase 설정을 넣으면 기기 간 동기화를 켤 수 있어요. 지금은 이 기기에만 저장됩니다.</div>`;
  } else if (s.user) {
    syncBlock = `
      <div class="info sync-on">☁️ <b>${esc(s.user.displayName || s.user.email)}</b> 계정으로 기기 간 동기화 중
        <span class="badge">${esc(SYNC_LABEL[s.status] || s.status)}</span></div>
      <button class="btn" data-action="sign-out">로그아웃</button>`;
  } else {
    syncBlock = `
      <div class="info">기기 간 동기화를 켜려면 Google로 로그인하세요. 로그인 전에는 이 기기에만 저장됩니다(로그인은 선택).</div>
      <button class="btn primary" data-action="sign-in">☁️ Google로 로그인해 동기화</button>`;
  }

  // 백업 섹션은 맥락에 따라 다르게: 로그인 시 클라우드가 1차 안전망 → 내보내기는 보조.
  // 비로그인 시 내보내기가 유일한 안전망 → 강하게 안내 + 로그인 권유.
  const loggedIn = !!s.user;
  const backupBlock = loggedIn ? `
      <h2 class="section-title">백업 / 내보내기</h2>
      <div class="info">
        ☁️ 로그인되어 있어 변경사항이 <b>클라우드에 자동 저장</b>돼요. 다만 동기화는
        삭제까지 함께 퍼지니, <b>실수로 지웠거나 계정을 잃었을 때</b>를 대비해 가끔
        파일로도 내보내 두면 더 안전해요(추가 안전장치).
        <br>마지막 내보내기: <b>${esc(last)}</b>
      </div>
      <button class="btn" data-action="export">📤 데이터 내보내기 (백업 파일)</button>
      <button class="btn" data-action="import-pick">📥 가져오기</button>
      <input id="import-file" type="file" accept="application/json,.json" hidden>` : `
      <h2 class="section-title">백업 (중요)</h2>
      <div class="info">
        이 앱의 데이터는 <b>이 브라우저에만</b> 저장돼요. 브라우저 데이터를 지우거나
        오랫동안 안 열면 사라질 수 있어요. <b>위에서 Google 로그인</b>하면 자동으로
        안전하게 보관돼요. 로그인이 싫다면 주기적으로 내보내기로 백업하세요.
        <br>마지막 백업: <b>${esc(last)}</b>${needBackup ? ' <span class="badge risk">백업 권장</span>' : ''}
        <br>저장 영속 권한: <b>${persisted ? '허용됨' : '미허용'}</b>
      </div>
      <button class="btn primary" data-action="export">📤 내보내기 (JSON)</button>
      <button class="btn" data-action="import-pick">📥 가져오기</button>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
      <button class="btn" data-action="req-persist">저장 영속 권한 요청</button>`;

  return `
    <div class="settings">
      <h1>설정</h1>

      <h2 class="section-title">클라우드 동기화</h2>
      ${syncBlock}

      ${backupBlock}

      <h2 class="section-title">기기</h2>
      <button class="btn" data-action="go-devices">내 기기 관리</button>

      <h2 class="section-title">정보</h2>
      <p class="muted small">조리값은 추정 시작점입니다. 특히 닭·돼지·다짐육은 중심온도로 익힘을 판단하세요.</p>
    </div>`;
}

export function backupNudge(settings, loggedIn) {
  if (loggedIn) return '';   // 로그인 시 클라우드 자동 백업 → 수동 백업 잔소리 안 함
  if ((settings.changeCount || 0) < 5) return '';
  return `<div class="nudge" data-action="go-settings">💾 변경사항이 쌓였어요. 백업하시겠어요? <b>설정 →</b></div>`;
}

// ---------------------------------------------------------------------------
// Toast / Bottom Sheet (네이티브 alert/confirm 대체)
// ---------------------------------------------------------------------------
export function toast(msg, type = '', ms = 2600) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.setAttribute('role', 'status');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

// 실행취소 액션이 있는 토스트
export function toastUndo(msg, onUndo, ms = 5000) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span></span><button class="toast__act">실행취소</button>`;
  el.querySelector('span').textContent = msg;
  let done = false;
  const remove = () => { if (done) return; done = true; el.classList.add('hide'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
  el.querySelector('.toast__act').onclick = () => { onUndo(); remove(); };
  wrap.appendChild(el);
  setTimeout(remove, ms);
}

export function confirmSheet({ title, message, okText = '확인', cancelText = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'sheet-backdrop';
    back.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="sheet-actions">
          <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${esc(okText)}</button>
          <button class="btn" data-cancel>${esc(cancelText)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = (val) => {
      back.classList.add('hide');
      back.addEventListener('animationend', () => { back.remove(); resolve(val); }, { once: true });
    };
    back.querySelector('[data-ok]').onclick = () => close(true);
    back.querySelector('[data-cancel]').onclick = () => close(false);
    back.onclick = (e) => { if (e.target === back) close(false); };
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); close(false); }
    });
    back.querySelector('[data-ok]').focus();
  });
}
