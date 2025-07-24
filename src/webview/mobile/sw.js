// Service Worker for Claude Autopilot Mobile Interface
const CACHE_NAME = 'claude-autopilot-mobile-v1';
const OFFLINE_URL = '/offline.html';

// Resources to cache for offline use
const CACHE_RESOURCES = [
    '/',
    '/styles.css',
    '/script.js',
    '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
    console.log('[SW] Install event');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching resources');
                return cache.addAll(CACHE_RESOURCES);
            })
            .then(() => {
                // Force the new service worker to activate
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate event');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                // Claim all clients immediately
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Handle API requests differently
    if (event.request.url.includes('/api/')) {
        event.respondWith(handleApiRequest(event.request));
        return;
    }
    
    // Handle WebSocket connections (skip caching)
    if (event.request.url.includes('/ws')) {
        return;
    }
    
    // Cache-first strategy for static resources
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    console.log('[SW] Serving from cache:', event.request.url);
                    return cachedResponse;
                }
                
                // If not in cache, fetch from network
                return fetch(event.request)
                    .then((response) => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // Clone the response for caching
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return response;
                    })
                    .catch(() => {
                        // If network fails, show offline page for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match(OFFLINE_URL);
                        }
                        
                        // For other requests, return a generic offline response
                        return new Response('Offline', {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: new Headers({
                                'Content-Type': 'text/plain'
                            })
                        });
                    });
            })
    );
});

// Handle API requests with offline fallback
function handleApiRequest(request) {
    return fetch(request)
        .then((response) => {
            // If successful, return the response
            if (response.ok) {
                return response;
            }
            
            // If not successful, throw to trigger catch block
            throw new Error('API request failed');
        })
        .catch(() => {
            // Return cached offline response for API requests
            const offlineResponse = {
                error: 'Offline',
                message: 'You are currently offline. Please check your connection.',
                cached: true,
                timestamp: Date.now()
            };
            
            return new Response(JSON.stringify(offlineResponse), {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({
                    'Content-Type': 'application/json'
                })
            });
        });
}

// Handle background sync (if supported)
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
    
    if (event.tag === 'queue-sync') {
        event.waitUntil(syncQueueData());
    }
});

// Sync queue data when back online
function syncQueueData() {
    return new Promise((resolve) => {
        // This would implement syncing cached queue operations
        // when the connection is restored
        console.log('[SW] Syncing queue data...');
        
        // For now, just resolve immediately
        // In a full implementation, this would:
        // 1. Get cached queue operations from IndexedDB
        // 2. Send them to the server
        // 3. Clear the cache on success
        
        resolve();
    });
}

// Handle push notifications (if needed)
self.addEventListener('push', (event) => {
    console.log('[SW] Push received');
    
    const options = {
        body: event.data ? event.data.text() : 'Claude Autopilot notification',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: {
            url: '/'
        },
        actions: [
            {
                action: 'view',
                title: 'View',
                icon: '/icons/icon-72x72.png'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Claude Autopilot', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification click:', event.action);
    
    event.notification.close();
    
    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.matchAll({ type: 'window' })
                .then((clientList) => {
                    // If a window is already open, focus it
                    for (const client of clientList) {
                        if (client.url === '/' && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    
                    // Otherwise, open a new window
                    if (clients.openWindow) {
                        return clients.openWindow('/');
                    }
                })
        );
    }
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('[SW] Service Worker loaded');