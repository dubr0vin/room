// Room needs a live connection to the TV. Always load the current site from the network.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (
    event.request.method !== 'GET' ||
    event.request.mode !== 'navigate' ||
    new URL(event.request.url).origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Room — нет подключения</title>
<style>
  body {
    margin: 0;
    min-height: 100svh;
    display: grid;
    place-items: center;
    background: #000;
    color: #eee;
    font: 18px system-ui;
  }
  main {
    max-width: 420px;
    padding: 32px;
    text-align: center;
  }
  p {
    color: #aaa;
    line-height: 1.5;
  }
  button {
    padding: 12px 20px;
    border: 0;
    border-radius: 8px;
    background: #228be6;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }
</style>
<main>
  <h1>Room недоступен</h1>
  <p>Проверь подключение к сети комнаты и попробуй ещё раз.</p>
  <form><button>Повторить</button></form>
</main>
</html>`,
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
