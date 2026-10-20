/* Mayha Square Pickleball Court service worker.
   - Pages, code and styles: always fetched fresh when online, so a new deploy shows up on the next visit.
     The saved copy is only used when the phone is offline or the network takes longer than 4 seconds.
   - Images and fonts: shown from the saved copy straight away and refreshed in the background.
   - Firebase (bookings, sign-in, payments) is never cached here; it always talks to the live database.
   Change VERSION only if you want every phone to throw away its saved copy and start fresh. */
const VERSION = "v1";
const CACHE = `mayha-${VERSION}`;
const SHELL = [
  "./", "./index.html", "./my-bookings.html", "./admin.html",
  "./styles.css", "./auth.css", "./branding.css", "./duration.css", "./brand-theme.css", "./payments.css", "./polish.css",
  "./my-bookings.css", "./my-bookings-payment.css", "./admin.css",
  "./site-config.js", "./app.js", "./my-bookings.js", "./my-bookings-payments.js", "./admin.js",
  "./mayha-logo-64.png", "./mayha-logo-64.webp", "./mayha-logo-128.webp", "./mayha-logo-256.webp", "./icon-192.png", "./icon-512.png", "./site.webmanifest"
];
const NETWORK_WAIT_MS = 4000;

self.addEventListener("install", event => {
  // Save each file on its own, so one missing file (like an optional QR image) never stops the rest.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("mayha-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

const isFont = url => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
const isImage = url => /\.(png|jpe?g|webp|svg|gif|ico)$/i.test(url.pathname);

/* Fresh first: try the network, fall back to the saved copy if offline or too slow. */
async function freshFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(response => { if (response.ok) cache.put(request, response.clone()); return response; });
  network.catch(() => {}); // handled below; stops a "failed to fetch" warning when the saved copy is used
  try {
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), NETWORK_WAIT_MS))]);
  } catch {
    const saved = await cache.match(request, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
    if (saved) return unredirect(saved);
    try { return await network; } catch { return request.mode === "navigate" ? offlinePage() : Response.error(); }
  }
}
/* A saved page that came through a redirect (for example "/" → "/index.html") can't be shown for a page visit as-is. */
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}
/* Saved first: show the saved copy now, refresh it in the background for next time. */
async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  const network = fetch(request).then(response => { if (response.ok || response.type === "opaque") cache.put(request, response.clone()); return response; }).catch(() => saved || Response.error());
  return saved || network;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isFont(url)) { event.respondWith(savedFirst(request)); return; }
  if (url.origin !== self.location.origin) return; // Firebase, the screenshot reader and other services go straight to the network
  if (url.pathname.endsWith("/sw.js")) return;
  if (request.mode === "navigate") { event.respondWith(freshFirst(request, url.pathname.includes("my-bookings") ? "./my-bookings.html" : "./index.html")); return; }
  if (isImage(url)) { event.respondWith(savedFirst(request)); return; }
  event.respondWith(freshFirst(request));
});

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f3f8fc"><title>You're offline · Mayha Square</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#f3f8fc;color:#14509a;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
main{max-width:340px}h1{margin:16px 0 8px;font:800 1.75rem/1.15 Georgia,serif}p{margin:0 0 24px;color:#5d6f80}button{min-height:48px;padding:0 24px;border:0;border-radius:8px;background:#7fe08a;color:#0f2f57;font:700 1rem system-ui,sans-serif;cursor:pointer}button:active{transform:scale(.97)}
@media (prefers-color-scheme:dark){body{background:#0e1621;color:#e4eefa}p{color:#9db0c4}}</style></head>
<body><main><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 8.5a16 16 0 0 1 20 0M5.5 12a11 11 0 0 1 13 0M9 15.5a6 6 0 0 1 6 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/><path d="M3 3l18 18"/></svg>
<h1>You're offline</h1><p>Booking a court needs an internet connection. Check your Wi-Fi or mobile data, then try again.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
