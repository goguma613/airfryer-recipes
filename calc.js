// calc.js — 보정 로직 (순수함수). DOM/저장소 의존 없음 → 테스트 가능.
//
// ⚠️ 중요: 에어프라이어 조리시간은 두께·밀도·기기 구조에 좌우되는 비선형 문제로,
//   아래 계수는 "정확값"이 아니라 "대략적 시작점"이다. 결과는 항상 구간으로 제시하고
//   위험식품은 시간이 아니라 중심온도로 완료를 판정해야 한다.

// 전역 기본 보정 계수 (상단 분리 — 튜닝 용이)
export const FACTORS = {
  amountExp: 0.4,     // 시간 ∝ (양 비)^amountExp  (무게는 두께의 거친 대리변수)
  wattExp: 0.7,       // 시간 ∝ (기준W/대상W)^wattExp  (약한 축)
  ovenTempDrop: 20,   // 오븐→에어프라이어: 온도 -20℃
  ovenTimeMult: 0.8,  // 오븐→에어프라이어: 시간 ×0.8
  ovenTempDropConvection: 8, // 컨벡션 오븐이면 차감 줄임
  rangeSpread: 0.15,  // 결과 구간 ±15%
  frozenExtra: 0.25,  // 냉동 시작 시 안전 마진(+25%) 및 경고
};

// 위험식품 카테고리 기본 중심온도(℃) — USDA 기준
export const CORE_TEMPS = {
  poultry: 74,   // 가금류(닭/오리/칠면조)
  groundMeat: 71,// 간고기(다짐육)
  porkBeefWhole: 63, // 통살 돼지/소/양 (+3분 휴지)
  fish: 63,
  egg: 71,
  reheat: 74,    // 재가열
};

function round1(n) { return Math.round(n); }
function avg(arr) {
  const ns = arr.map(Number).filter(Number.isFinite);
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

/**
 * 조리값 보정.
 * @param {object} baseline { baseTemp, baseTime, baseAmount, baseWattage, source, startState, convection }
 * @param {object} target   { wattage, factorOverride }
 * @param {number|null} targetAmount  목표 양(g)
 * @param {object} factors  기본 FACTORS 위에 덮어쓸 값
 * @returns {{ temp:number, timeMin:number, timeMax:number, notes:string[], unreliable:boolean }}
 */
export function adjust(baseline, target, targetAmount, factors = FACTORS) {
  const f = Object.assign({}, FACTORS, factors, (target && target.factorOverride) || {});
  const notes = [];
  let unreliable = false;

  let temp = Number(baseline.baseTemp) || 0;
  let time = Number(baseline.baseTime) || 0;

  // 1) 오븐 출처 → 에어프라이어 변환
  if (baseline.source === 'oven') {
    const drop = baseline.convection ? f.ovenTempDropConvection : f.ovenTempDrop;
    temp -= drop;
    time *= f.ovenTimeMult;
    notes.push(`오븐 → 에어프라이어라서 온도를 ${drop}℃ 낮추고 시간을 ${Math.round(f.ovenTimeMult * 100)}%로 줄였어요.`);
  }

  // 2) 양 보정 (무게 기반 — 거친 추정)
  const baseAmt = Number(baseline.baseAmount);
  const tgtAmt = Number(targetAmount);
  if (baseAmt > 0 && tgtAmt > 0 && baseAmt !== tgtAmt) {
    const ratio = tgtAmt / baseAmt;
    time *= Math.pow(ratio, f.amountExp);
    notes.push(`양이 ${baseAmt}g → ${tgtAmt}g이라 시간을 ${ratio > 1 ? '늘렸' : '줄였'}어요.`);
    if (ratio > 1.5) notes.push('양이 많이 늘었어요 — 한 겹으로 펴고 중간에 더 자주 확인하세요.');
  }

  // 3) 와트 보정 (약한 축 — 작게만)
  const bw = Number(baseline.baseWattage);
  const tw = target && Number(target.wattage);
  if (bw > 0 && tw > 0 && bw !== tw) {
    time *= Math.pow(bw / tw, f.wattExp);
    notes.push(`기기 출력이 ${bw}W → ${tw}W라 시간을 ${tw < bw ? '조금 늘렸' : '조금 줄였'}어요 (영향은 작아요).`);
  }

  // 4) 냉동 시작: 안전 마진 + 경고 (시간만 믿지 말 것)
  if (baseline.startState === 'frozen') {
    time *= (1 + f.frozenExtra);
    notes.push('냉동이라 안전 마진으로 시간을 늘렸어요. 시간보다 속까지 익었는지로 판단하세요.');
    unreliable = true;
  }

  // 결과 구간화
  const timeMin = Math.max(1, round1(time * (1 - f.rangeSpread)));
  const timeMax = Math.max(timeMin, round1(time * (1 + f.rangeSpread)));

  return {
    temp: round1(temp),
    timeMin,
    timeMax,
    notes,
    unreliable,
  };
}

/**
 * 3층 우선순위 중 ③: 이 기기에서 마지막으로 성공한 설정 제안.
 * 회귀가 아닌 단순 규칙(데이터 적어 과적합 방지).
 * @returns {{temp, time, amount, date}|null}
 */
export function suggestFromHistory(recipe, deviceId) {
  if (!recipe || !Array.isArray(recipe.successLog)) return null;
  // 닫힌 학습 루프 + 다회 집계(회귀 아님 — 데이터 적어 단순 규칙):
  //  · 마지막이 성공이면 최근 성공 최대 3번을 평균내 한 번의 변동을 흡수해 안정화.
  //  · 마지막이 실패면 그 시도를 기준으로 보정(사용자가 적은 '다음엔 ±분'이 최우선).
  const logs = recipe.successLog
    .filter(l => (!deviceId || l.deviceId === deviceId))
    .filter(l => l.actualTemp != null && l.actualTime != null);
  if (logs.length === 0) return null;
  const last = logs[logs.length - 1];
  const sign = (n) => (n > 0 ? '+' : '') + n;

  if (last.result === 'good') {
    const recent = logs.filter(l => l.result === 'good').slice(-3);
    const temp = Math.round(avg(recent.map(g => g.actualTemp)));
    const time = Math.round(avg(recent.map(g => g.actualTime)));
    const reason = recent.length >= 2 ? `최근 성공 ${recent.length}번 평균` : '지난번 딱 좋았던 값';
    return { temp, time, amount: last.actualAmount, date: last.date, result: 'good', reason, count: recent.length };
  }

  const temp = Number(last.actualTemp);
  let time = Number(last.actualTime);
  const adj = Number(last.nextAdjust);
  let reason;
  if (Number.isFinite(adj) && adj !== 0) {
    time = Math.max(1, time + adj);
    reason = last.result === 'undercooked' ? `지난번 덜 익어서 ${sign(adj)}분 제안`
      : `지난번 타서 ${sign(adj)}분 제안`;
  } else {
    const step = Math.max(2, Math.round(time * 0.12));
    if (last.result === 'undercooked') { time = time + step; reason = `지난번 덜 익어서 +${step}분 제안`; }
    else { time = Math.max(1, time - step); reason = `지난번 타서 -${step}분 제안`; }
  }
  return { temp, time, amount: last.actualAmount, date: last.date, result: last.result, reason, count: logs.length };
}

// 텍스트에서 온도/시간 자동추출 (봉지/사이트 붙여넣기용, 오프라인 정규식)
// "200도 12분", "180℃ 8~10분", "200°C 15 min" 등 대응. 한국어 우선.
export function extractFromText(text) {
  if (!text) return { temp: null, time: null };
  const t = String(text);

  let temp = null;
  // 180도 / 180℃ / 180°C / 180 도
  const tempM = t.match(/(\d{2,3})\s*(?:℃|°c|도)/i);
  if (tempM) temp = Number(tempM[1]);

  let time = null;
  // 12분 / 8~10분 / 8-10분 / 15 min  → 범위면 평균
  const rangeM = t.match(/(\d{1,3})\s*[-~]\s*(\d{1,3})\s*(?:분|min)/i);
  const singleM = t.match(/(\d{1,3})\s*(?:분|min)/i);
  if (rangeM) {
    time = Math.round((Number(rangeM[1]) + Number(rangeM[2])) / 2);
  } else if (singleM) {
    time = Number(singleM[1]);
  }

  return { temp, time };
}
