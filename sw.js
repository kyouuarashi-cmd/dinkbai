// Dink Bai Service Worker — enables PWA install and push notifications on iOS
const CACHE_NAME = 'dinkbai-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Handle push events for background notifications
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || '🏓 It\'s Your Turn!';
    const options = {
        body: data.body || 'You\'ve been assigned a match. Tap to accept!',
        icon: 'graphics/logo/Dinkbai_logo.png',
        badge: 'graphics/logo/Dinkbai_logo.png',
        tag: 'match-assignment',
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 500]
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click — focus the app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/index.html');
            }
        })
    );
});
