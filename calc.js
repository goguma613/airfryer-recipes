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
    notes.push(`오븐 레시피 변환: 온도 -${drop}℃, 시간 ×${f.ovenTimeMult}`);
  }

  // 2) 양 보정 (무게 기반 — 거친 추정)
  const baseAmt = Number(baseline.baseAmount);
  const tgtAmt = Number(targetAmount);
  if (baseAmt > 0 && tgtAmt > 0 && baseAmt !== tgtAmt) {
    const ratio = tgtAmt / baseAmt;
    time *= Math.pow(ratio, f.amountExp);
    notes.push(`양 보정: ${baseAmt}g→${tgtAmt}g (×${ratio.toFixed(2)}^${f.amountExp})`);
    if (ratio > 1.5) notes.push('양이 많이 늘었습니다 — 한 겹으로 펴고 중간에 더 자주 확인하세요.');
  }

  // 3) 와트 보정 (약한 축 — 작게만)
  const bw = Number(baseline.baseWattage);
  const tw = target && Number(target.wattage);
  if (bw > 0 && tw > 0 && bw !== tw) {
    time *= Math.pow(bw / tw, f.wattExp);
    notes.push(`기기 출력 보정: ${bw}W→${tw}W (참고값)`);
  }

  // 4) 냉동 시작: 안전 마진 + 경고 (시간만 믿지 말 것)
  if (baseline.startState === 'frozen') {
    time *= (1 + f.frozenExtra);
    notes.push('냉동 상태: 안전 마진 +시간. 시간보다 중심온도/속까지 익었는지로 판단하세요.');
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
  const goods = recipe.successLog
    .filter(l => l.result === 'good' && (!deviceId || l.deviceId === deviceId))
    .filter(l => l.actualTemp != null && l.actualTime != null);
  if (goods.length === 0) return null;
  const last = goods[goods.length - 1];
  return { temp: last.actualTemp, time: last.actualTime, amount: last.actualAmount, date: last.date };
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
