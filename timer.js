// timer.js — 조리 타이머 + 다단계 알림 + Wake Lock (화면 꺼짐 방지)
// 주방 현실 대응: 화면 유지, 종료/단계 진동+소리 알림.

export class CookTimer {
  /**
   * @param {object} opts
   *   totalSec: 전체 초
   *   steps: [{ atMin, label }]  중간 단계 알림
   *   onTick(remainingSec)
   *   onStep({ atMin, label })
   *   onDone()
   */
  constructor(opts) {
    this.totalSec = Math.max(1, Math.round(opts.totalSec || 0));
    this.remaining = this.totalSec;
    this.steps = (opts.steps || []).map(s => ({ atSec: Math.round(s.atMin * 60), label: s.label, fired: false }));
    this.onTick = opts.onTick || (() => {});
    this.onStep = opts.onStep || (() => {});
    this.onDone = opts.onDone || (() => {});
    this._interval = null;
    this._wakeLock = null;
    this._running = false;
  }

  async start() {
    if (this._running) return;
    this._running = true;
    await this._acquireWakeLock();
    this.onTick(this.remaining);
    this._interval = setInterval(() => this._step(), 1000);
  }

  _step() {
    this.remaining -= 1;
    // 경과 시점 기준 단계 알림
    const elapsed = this.totalSec - this.remaining;
    this.steps.forEach(s => {
      if (!s.fired && elapsed >= s.atSec && this.remaining > 0) {
        s.fired = true;
        buzz([200, 100, 200]);
        beep(2);
        this.onStep({ atMin: Math.round(s.atSec / 60), label: s.label });
      }
    });

    if (this.remaining <= 0) {
      this.onTick(0);
      this.stop();
      buzz([400, 150, 400, 150, 400]);
      beep(4);
      this.onDone();
      return;
    }
    this.onTick(this.remaining);
  }

  pause() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._running = false;
  }

  resume() { if (!this._running) this.start(); }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._running = false;
    this._releaseWakeLock();
  }

  addSeconds(sec) {
    this.remaining = Math.max(0, this.remaining + sec);
    this.totalSec = Math.max(this.totalSec, this.remaining);
    this.onTick(this.remaining);
  }

  get running() { return this._running; }

  async _acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        // 화면 복귀 시 재획득
        document.addEventListener('visibilitychange', this._onVisible = async () => {
          if (this._running && document.visibilityState === 'visible' && !this._wakeLock) {
            try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
          }
        });
      }
    } catch (e) { /* Wake Lock 미지원 — 무시 */ }
  }

  _releaseWakeLock() {
    try { if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; } } catch (e) {}
    if (this._onVisible) { document.removeEventListener('visibilitychange', this._onVisible); this._onVisible = null; }
  }
}

// 진동 (지원 기기에서만)
export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// 비프음 (WebAudio — 별도 파일 불필요)
let _audioCtx = null;
export function beep(times = 1) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t0 = ctx.currentTime + i * 0.3;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.start(t0); osc.stop(t0 + 0.25);
    }
  } catch (e) { /* 오디오 미지원 — 무시 */ }
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
