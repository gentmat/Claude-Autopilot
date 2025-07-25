# Claude Autopilot Mobile Interface Specifications

## 🎯 **Overview**

A mobile-first web interface for remotely controlling Claude Autopilot from any device. Designed for the "control your code from bed" use case, providing intuitive touch controls and real-time monitoring of automated Claude sessions.

## 📱 **Design Principles**

### 1. **Mobile-First Approach**
- **Touch-Optimized**: All interactive elements sized for finger navigation (minimum 44px)
- **Thumb-Friendly**: Primary actions accessible within thumb reach zones
- **Gesture-Driven**: Swipe, long-press, and pull-to-refresh interactions
- **One-Handed Operation**: Core functions usable with single hand

### 2. **Progressive Enhancement**
- **Works Offline**: Graceful degradation when connection is lost
- **Fast Loading**: Critical path renders in under 2 seconds
- **Installable**: PWA capabilities for home screen installation
- **Responsive**: Adapts from phone to tablet to desktop

### 3. **Visual Hierarchy**
- **Status-First**: Current state immediately visible
- **Action-Oriented**: Clear call-to-action buttons
- **Information Density**: Optimal content without overwhelming
- **Dark Mode Native**: Designed for low-light usage

## 🎨 **Visual Design System**

### **Color Palette**
```css
:root {
  /* Primary Colors */
  --primary-blue: #007acc;
  --primary-blue-dark: #005a9e;
  --primary-blue-light: #4da6ff;
  
  /* Status Colors */
  --success-green: #28a745;
  --warning-orange: #fd7e14;
  --danger-red: #dc3545;
  --info-cyan: #17a2b8;
  
  /* Dark Theme */
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d30;
  --bg-tertiary: #3e3e42;
  --text-primary: #ffffff;
  --text-secondary: #cccccc;
  --text-muted: #969696;
  
  /* Light Theme */
  --bg-primary-light: #ffffff;
  --bg-secondary-light: #f8f9fa;
  --bg-tertiary-light: #e9ecef;
  --text-primary-light: #212529;
  --text-secondary-light: #495057;
  --text-muted-light: #6c757d;
}
```

### **Typography Scale**
```css
/* Mobile Typography */
.text-hero { font-size: 2rem; font-weight: 700; } /* 32px */
.text-title { font-size: 1.5rem; font-weight: 600; } /* 24px */
.text-heading { font-size: 1.25rem; font-weight: 600; } /* 20px */
.text-body { font-size: 1rem; font-weight: 400; } /* 16px */
.text-small { font-size: 0.875rem; font-weight: 400; } /* 14px */
.text-caption { font-size: 0.75rem; font-weight: 400; } /* 12px */
```

### **Spacing System**
```css
/* 8px base unit system */
--space-xs: 0.25rem;  /* 4px */
--space-sm: 0.5rem;   /* 8px */
--space-md: 1rem;     /* 16px */
--space-lg: 1.5rem;   /* 24px */
--space-xl: 2rem;     /* 32px */
--space-2xl: 3rem;    /* 48px */
```

## 📐 **Layout Structure**

### **Mobile Layout (320px - 768px)**
```
┌─────────────────────────────┐
│ Header (60px)               │
│ ┌─ Status Indicator         │
│ └─ Connection Badge         │
├─────────────────────────────┤
│ Quick Actions (120px)       │
│ ┌─ Start ─┬─ Stop ─┬─ Reset │
│ └─ (40px)─┴─(40px)─┴─(40px) │
├─────────────────────────────┤
│ Queue Section (Expandable)  │
│ ┌─ Queue Header (48px)      │
│ ├─ Add Message Button       │
│ ├─ Queue Items (Scrollable) │
│ └─ Queue Actions            │
├─────────────────────────────┤
│ Output Section (Expandable) │
│ ┌─ Output Header (48px)     │
│ ├─ Live Output (Scrollable) │
│ └─ Output Controls          │
├─────────────────────────────┤
│ Status Bar (40px)           │
│ └─ Connection • Messages    │
└─────────────────────────────┘
```

### **Tablet Layout (768px - 1024px)**
```
┌─────────────────────────────────────────────┐
│ Header (60px)                               │
├─────────────────┬───────────────────────────┤
│ Control Panel   │ Live Output               │
│ ┌─ Quick Actions │ ┌─ Claude Output          │
│ ├─ Queue Section │ ├─ Terminal Logs          │
│ └─ Status Info   │ └─ Error Messages         │
│                 │                           │
│ (40% width)     │ (60% width)               │
└─────────────────┴───────────────────────────┘
```

## 🎛️ **Component Specifications**

### 1. **Header Component**
```html
<header class="mobile-header">
  <div class="header-content">
    <h1 class="app-title">
      <span class="app-icon">🤖</span>
      Claude Autopilot
    </h1>
    <div class="status-indicators">
      <div class="connection-status" data-status="connected">
        <span class="status-dot"></span>
        <span class="status-text">Connected</span>
      </div>
      <div class="session-status" data-status="running">
        <span class="session-icon">▶️</span>
      </div>
    </div>
  </div>
</header>
```

**States:**
- **Connection**: `connected` | `disconnected` | `reconnecting`
- **Session**: `idle` | `running` | `paused` | `error`

### 2. **Quick Actions Component**
```html
<section class="quick-actions">
  <button class="action-btn action-btn--start" data-action="start">
    <span class="btn-icon">▶️</span>
    <span class="btn-text">Start</span>
    <span class="btn-subtitle">Begin processing</span>
  </button>
  
  <button class="action-btn action-btn--stop" data-action="stop">
    <span class="btn-icon">⏹️</span>
    <span class="btn-text">Stop</span>
    <span class="btn-subtitle">Pause queue</span>
  </button>
  
  <button class="action-btn action-btn--reset" data-action="reset">
    <span class="btn-icon">🔄</span>
    <span class="btn-text">Reset</span>
    <span class="btn-subtitle">Clear session</span>
  </button>
</section>
```

**Button States:**
```css
.action-btn {
  min-height: 80px;
  min-width: 100px;
  border-radius: 12px;
  transition: all 0.2s ease;
}

.action-btn:disabled {
  opacity: 0.5;
  transform: none;
}

.action-btn:active {
  transform: scale(0.95);
}
```

### 3. **Queue Management Component**
```html
<section class="queue-section">
  <header class="section-header">
    <h2 class="section-title">
      Message Queue
      <span class="queue-counter" data-count="3">3</span>
    </h2>
    <button class="section-toggle" data-expanded="true">
      <span class="toggle-icon">▼</span>
    </button>
  </header>
  
  <div class="section-content">
    <button class="add-message-btn">
      <span class="btn-icon">➕</span>
      Add Message
    </button>
    
    <div class="queue-container">
      <div class="queue-item" data-status="pending" data-id="msg-1">
        <div class="item-content">
          <div class="item-text">Fix the authentication bug in login.js</div>
          <div class="item-meta">
            <span class="item-time">2 min ago</span>
            <span class="item-status">Pending</span>
          </div>
        </div>
        <div class="item-actions">
          <button class="item-action" data-action="edit">✏️</button>
          <button class="item-action" data-action="duplicate">📋</button>
          <button class="item-action" data-action="delete">🗑️</button>
        </div>
      </div>
    </div>
  </div>
</section>
```

**Queue Item States:**
- **pending**: Waiting to be processed
- **processing**: Currently being handled by Claude
- **completed**: Successfully processed
- **error**: Failed with error
- **skipped**: Manually skipped

### 4. **Live Output Component**
```html
<section class="output-section">
  <header class="section-header">
    <h2 class="section-title">Live Output</h2>
    <div class="output-controls">
      <button class="control-btn" data-action="clear">Clear</button>
      <button class="control-btn" data-action="scroll-lock">📌</button>
    </div>
  </header>
  
  <div class="section-content">
    <div class="output-container">
      <div class="output-stream" id="claude-output">
        <div class="output-line" data-type="claude">
          <span class="line-prefix">🤖</span>
          <span class="line-content">I'll help you fix the authentication bug...</span>
          <span class="line-time">14:32:15</span>
        </div>
        <div class="output-line" data-type="system">
          <span class="line-prefix">⚙️</span>
          <span class="line-content">Processing message 1 of 3</span>
          <span class="line-time">14:32:10</span>
        </div>
      </div>
    </div>
  </div>
</section>
```

## 🤏 **Touch Interactions**

### **Gesture Mapping**
```javascript
// Queue Item Gestures
const gestureMap = {
  // Swipe left to delete
  swipeLeft: (item) => showDeleteConfirmation(item),
  
  // Swipe right to duplicate
  swipeRight: (item) => duplicateQueueItem(item),
  
  // Long press to edit
  longPress: (item) => openEditDialog(item),
  
  // Double tap to toggle details
  doubleTap: (item) => toggleItemDetails(item),
  
  // Pull to refresh (on container)
  pullToRefresh: () => refreshQueueData()
};
```

### **Swipe Implementation**
```css
.queue-item {
  position: relative;
  transform: translateX(0);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.queue-item.swiping {
  transition: none;
}

.queue-item.swipe-left {
  transform: translateX(-100px);
}

.queue-item.swipe-right {
  transform: translateX(100px);
}

/* Swipe action indicators */
.queue-item::before,
.queue-item::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.queue-item::before {
  left: -80px;
  background: var(--danger-red);
  content: '🗑️';
}

.queue-item::after {
  right: -80px;
  background: var(--info-cyan);
  content: '📋';
}

.queue-item.swipe-left::before,
.queue-item.swipe-right::after {
  opacity: 1;
}
```

## 📱 **Responsive Breakpoints**

### **Mobile Portrait (320px - 480px)**
```css
@media (max-width: 480px) {
  .quick-actions {
    grid-template-columns: 1fr;
    gap: var(--space-sm);
  }
  
  .action-btn {
    min-height: 60px;
    flex-direction: row;
  }
  
  .btn-subtitle {
    display: none;
  }
}
```

### **Mobile Landscape (481px - 768px)**
```css
@media (min-width: 481px) and (max-width: 768px) {
  .quick-actions {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .queue-section,
  .output-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }
}
```

### **Tablet (769px - 1024px)**
```css
@media (min-width: 769px) {
  .mobile-main {
    display: grid;
    grid-template-columns: 400px 1fr;
    gap: var(--space-lg);
  }
  
  .control-panel {
    grid-column: 1;
  }
  
  .output-panel {
    grid-column: 2;
  }
}
```

## 🔄 **Real-Time Updates**

### **WebSocket Connection**
```javascript
class MobileInterface {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }
  
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.updateConnectionStatus('connected');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleUpdate(data);
    };
    
    this.ws.onclose = () => {
      this.updateConnectionStatus('disconnected');
      this.attemptReconnect();
    };
  }
  
  handleUpdate(data) {
    switch (data.type) {
      case 'queue_update':
        this.updateQueue(data.queue);
        break;
      case 'output_line':
        this.appendOutput(data.line);
        break;
      case 'session_status':
        this.updateSessionStatus(data.status);
        break;
    }
  }
}
```

### **Offline Handling**
```javascript
// Service Worker for offline support
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Return cached response or offline message
          return new Response(
            JSON.stringify({ error: 'Offline', cached: true }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
  }
});
```

## 🎯 **Performance Targets**

### **Loading Performance**
- **First Contentful Paint**: < 1.5s
- **Largest Contentful Paint**: < 2.5s
- **Time to Interactive**: < 3s
- **Cumulative Layout Shift**: < 0.1

### **Runtime Performance**
- **Touch Response**: < 100ms
- **Animation Frame Rate**: 60fps
- **Memory Usage**: < 50MB
- **Battery Impact**: Minimal (efficient polling)

### **Network Efficiency**
- **Initial Bundle**: < 200KB gzipped
- **WebSocket Messages**: < 1KB average
- **Update Frequency**: 1-2 updates/second max
- **Offline Capability**: 5+ minutes cached operation

## 🧪 **Testing Strategy**

### **Device Testing Matrix**
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Device      │ Screen Size │ OS          │ Browser     │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ iPhone SE   │ 375x667     │ iOS 15+     │ Safari      │
│ iPhone 12   │ 390x844     │ iOS 15+     │ Safari      │
│ Pixel 5     │ 393x851     │ Android 11+ │ Chrome      │
│ iPad Air    │ 820x1180    │ iOS 15+     │ Safari      │
│ Galaxy Tab  │ 800x1280    │ Android 11+ │ Chrome      │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### **Interaction Testing**
- **Touch Accuracy**: All buttons hittable with 9mm finger
- **Gesture Recognition**: 95%+ swipe detection accuracy
- **Scroll Performance**: Smooth 60fps scrolling
- **Form Input**: Keyboard doesn't obscure inputs

### **Accessibility Testing**
- **Screen Reader**: VoiceOver/TalkBack compatibility
- **High Contrast**: Readable in accessibility modes
- **Large Text**: Scales properly with system settings
- **Motor Impairments**: Alternative interaction methods

## 🚀 **Progressive Web App Features**

### **Manifest Configuration**
```json
{
  "name": "Claude Autopilot Remote",
  "short_name": "Claude Remote",
  "description": "Remote control for Claude Autopilot automation",
  "start_url": "/web?source=pwa",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#007acc",
  "background_color": "#1e1e1e",
  "categories": ["productivity", "developer"],
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### **Installation Prompts**
```javascript
// PWA Installation
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Show custom install button
  showInstallButton();
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('PWA installed');
      }
      deferredPrompt = null;
    });
  }
}
```

## 📋 **Implementation Checklist**

### **Phase 1: Core Interface**
- [ ] Basic HTML structure and responsive layout
- [ ] CSS design system implementation
- [ ] Touch gesture detection library
- [ ] WebSocket connection management
- [ ] Basic queue display and controls

### **Phase 2: Advanced Interactions**
- [ ] Swipe gestures for queue management
- [ ] Pull-to-refresh implementation
- [ ] Long-press context menus
- [ ] Haptic feedback (where supported)
- [ ] Keyboard shortcuts for power users

### **Phase 3: PWA Features**
- [ ] Service worker for offline support
- [ ] App manifest and installation prompts
- [ ] Push notifications (if applicable)
- [ ] Background sync capabilities
- [ ] App shortcuts and widgets

### **Phase 4: Polish & Optimization**
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Cross-browser testing
- [ ] Error handling and recovery
- [ ] Analytics and usage tracking

---

This mobile interface specification provides a comprehensive foundation for building a touch-optimized remote control interface for Claude Autopilot. The design prioritizes usability, performance, and accessibility while maintaining the powerful functionality of the desktop extension.