/* LunaRise service worker: call alerts when the site is closed.
   A call alert rings (sound + vibration) every few seconds until the call is answered, ends or times out. */
const VERSION = 'lr-sw-1';
const ICON = './icon-192.png';
const stop = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// iPhone/iPad (Safari) turn alerts off for a site whose push messages show nothing, so there every push shows something
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android|Firefox/.test(self.navigator.userAgent);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
    let d = {};
    try { const j = e.data ? e.data.json() : {}; d = j.data || j || {}; } catch (x) { try { d = { type: 'text', body: e.data.text() }; } catch (y) { } }
    e.waitUntil(handle(d));
});
async function visibleClient() {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return all.find(c => c.visibilityState === 'visible') || null;
}
async function handle(d) {
    if (d.type === 'call') return ring(d);
    if (d.type === 'cancel') return cancel(d);
    return self.registration.showNotification(d.title || 'LunaRise', { body: d.body || '', icon: ICON, badge: ICON, tag: d.tag || 'lr' });
}
async function ring(d) {
    const tag = 'call-' + d.cid, exp = +d.exp || (Date.now() + 50000);
    delete stop[d.cid];
    // the site is on screen: it rings by itself
    const vis = await visibleClient();
    if (vis) {
        vis.postMessage({ type: 'lr-ring', cid: d.cid, from: d.from });
        if (APPLE) await self.registration.showNotification('📞 ' + (d.name || 'A friend') + ' is calling you', { body: 'LunaRise voice call', icon: ICON, tag, silent: true, data: d });
        return;
    }
    let i = 0;
    const times = APPLE ? 1 : 10;   // iPhone stacks repeated alerts instead of replacing them, so it gets one
    while (Date.now() < exp && !stop[d.cid] && i < times) {
        await self.registration.showNotification('📞 ' + (d.name || 'A friend') + ' is calling you', {
            body: 'LunaRise voice call · tap to answer', icon: ICON, badge: ICON, tag, renotify: true, requireInteraction: true,
            vibrate: [700, 300, 700, 300, 700], timestamp: Date.now(), data: d,
            actions: [{ action: 'answer', title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }]
        });
        i++;
        for (let k = 0; k < (i < times ? 12 : 200) && !stop[d.cid] && Date.now() < exp; k++) await sleep(500);
        if (await visibleClient()) break;
    }
    const open = await self.registration.getNotifications({ tag });
    if (stop[d.cid] === 'done') { open.forEach(n => n.close()); return; }
    if (!stop[d.cid]) await missed(d, open);
}
async function missed(d, open) {
    (open || await self.registration.getNotifications({ tag: 'call-' + d.cid })).forEach(n => n.close());
    await self.registration.showNotification('Missed call from ' + (d.name || 'a friend'), { body: 'Tap to open LunaRise and call back', icon: ICON, badge: ICON, tag: 'missed-' + d.cid, data: { type: 'missed', from: d.from, cid: d.cid } });
}
async function cancel(d) {
    const was = stop[d.cid]; stop[d.cid] = d.why === 'answered' ? 'done' : (was || 'missed');
    const open = await self.registration.getNotifications({ tag: 'call-' + d.cid });
    const vis = await visibleClient();
    if (vis) { open.forEach(n => n.close()); vis.postMessage({ type: 'lr-cancel', cid: d.cid, why: d.why }); return; }
    if (d.why === 'answered') {
        open.forEach(n => n.close());
        if (APPLE) await self.registration.showNotification('Call picked up', { icon: ICON, badge: ICON, tag: 'info-' + d.cid, silent: true });
        return;
    }
    if (was === 'done') { if (APPLE) await self.registration.showNotification('Call ended', { icon: ICON, tag: 'info-' + d.cid, silent: true }); return; }   // answered or declined here already
    return missed(d, open);
}
self.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'lr-stop' && m.cid) { stop[m.cid] = 'done'; self.registration.getNotifications({ tag: 'call-' + m.cid }).then(ns => ns.forEach(n => n.close())); }
});
self.addEventListener('notificationclick', onClick);
function onClick(e) {
    const n = e.notification, d = n.data || {}; n.close();
    if (d.type === 'call') stop[d.cid] = 'done';
    if (e.action === 'decline' && d.type === 'call') {
        e.waitUntil(fetch(d.srv, { method: 'POST', body: JSON.stringify({ op: 'decline', cid: d.cid, to: d.to, dk: d.dk }) }).catch(() => { }));
        return;
    }
    const url = new URL('./', self.registration.scope);
    if (d.type === 'call') { url.searchParams.set('call', d.cid); url.searchParams.set('from', d.from || ''); if (e.action === 'answer') url.searchParams.set('ans', '1'); }
    else if (d.type === 'missed' && d.from) url.searchParams.set('chat', d.from);
    e.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const w = all.find(c => c.url.startsWith(self.registration.scope));
        if (w) { w.postMessage({ type: d.type === 'call' ? 'lr-call' : 'lr-open', cid: d.cid, from: d.from, ans: e.action === 'answer' }); try { await w.focus(); } catch (x) { } return; }
        return self.clients.openWindow(url.href);
    })());
}
