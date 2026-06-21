// sw.js — 오프라인 캐시. 버전 올리면 옛 캐시 자동 정리(유령 버전 방지).
const CACHE = 'airfryer-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './store.js',
  './calc.js',
  './ui.js',
  './timer.js',
  './sync.js',
  './firebase-config.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting(); // 새 버전 즉시 활성화
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 우리 앱 파일(동일 출처)만 가로채 '항상 서버 최신'으로 가져온다 — HTTP 캐시까지 우회(no-store).
// → git push 후 새로고침 한 번이면 바로 반영. 네트워크 실패(오프라인)일 때만 캐시로 폴백.
// 외부 리소스(Firebase SDK·폰트 등 버전 고정·불변)는 가로채지 않고 브라우저 기본 캐시를 쓴다(빠름).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
