class MobileInterface {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.authToken = null;
        this.isScrollLocked = false;
        this.currentEditingMessageId = null;
        this.hasShownConnectedToast = false;
        
        // Mobile output state (like main extension)
        this.claudeContent = '';
        this.lastRenderedContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        
        // Throttling mechanism (exactly like main extension)
        this.pendingClaudeOutput = null;
        this.claudeRenderTimer = null;
        this.lastClaudeRenderTime = 0;
        this.CLAUDE_RENDER_THROTTLE_MS = 500; // 500ms = 2 times per second max
        
        // Touch gesture state
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchStartTime = 0;
        this.isSwiping = false;
        this.swipeThreshold = 100;
        this.longPressTimeout = null;
        this.longPressDelay = 500;
        
        this.init();
    }

    init() {
        this.extractAuthToken();
        this.setupEventListeners();
        this.connect();
        this.updateCurrentTime();
        setInterval(() => this.updateCurrentTime(), 1000);
    }

    extractAuthToken() {
        // First try to get token from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        this.authToken = urlParams.get('token');
        
        // If not found in URL, try to get from injected global variable
        if (!this.authToken && window.CLAUDE_AUTH_TOKEN) {
            this.authToken = window.CLAUDE_AUTH_TOKEN;
            console.log('Using injected auth token');
        }
        
        console.log('Extracted auth token:', this.authToken ? 'present' : 'missing');
        console.log('Current URL:', window.location.href);
        
        if (!this.authToken) {
            this.showToast('Authentication token missing', 'error');
            console.error('No token found in URL parameters or injected token');
        }
    }

    setupEventListeners() {
        // Control buttons
        document.getElementById('start-btn').addEventListener('click', () => this.handleControlAction('start'));
        document.getElementById('stop-btn').addEventListener('click', () => this.handleControlAction('stop'));
        document.getElementById('interrupt-btn').addEventListener('click', () => this.handleControlAction('interrupt'));
        document.getElementById('reset-btn').addEventListener('click', () => this.handleControlAction('reset'));

        // Add message
        document.getElementById('add-message-btn').addEventListener('click', () => this.showAddMessageModal());
        document.getElementById('confirm-add-message').addEventListener('click', () => this.addMessage());
        document.getElementById('cancel-add-message').addEventListener('click', () => this.hideAddMessageModal());
        document.getElementById('close-add-modal').addEventListener('click', () => this.hideAddMessageModal());

        // Edit message
        document.getElementById('confirm-edit-message').addEventListener('click', () => this.saveEditMessage());
        document.getElementById('cancel-edit-message').addEventListener('click', () => this.hideEditMessageModal());
        document.getElementById('close-edit-modal').addEventListener('click', () => this.hideEditMessageModal());

        // Output controls
        document.getElementById('clear-output-btn').addEventListener('click', () => this.clearOutput());
        document.getElementById('scroll-lock-btn').addEventListener('click', () => this.toggleScrollLock());

        // Section toggles
        document.getElementById('queue-toggle').addEventListener('click', () => this.toggleSection('queue'));

        // Modal backdrop clicks
        document.getElementById('add-message-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideAddMessageModal();
        });
        document.getElementById('edit-message-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideEditMessageModal();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Touch events for queue items (will be added dynamically)
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });

        // Handle online/offline status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
    }

    connect() {
        if (this.ws) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${this.authToken}`;
        
        this.updateConnectionStatus('connecting');
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to mobile server');
                this.updateConnectionStatus('connected');
                this.reconnectAttempts = 0;
                
                
                // Only show toast once per session or after disconnection
                if (!this.hasShownConnectedToast) {
                    this.showToast('Connected to Claude Autopilot', 'success');
                    this.hasShownConnectedToast = true;
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };
            
            this.ws.onclose = (event) => {
                console.log('WebSocket connection closed:', event.code, event.reason);
                this.updateConnectionStatus('disconnected');
                this.ws = null;
                
                // Reset the toast flag so it shows again on next successful connection
                this.hasShownConnectedToast = false;
                
                // Handle different close codes
                if (event.code === 1008) {
                    // Unauthorized - don't retry, show error
                    this.showToast('Authentication failed. Please refresh the page.', 'error');
                    this.reconnectAttempts = this.maxReconnectAttempts; // Stop retrying
                } else if (event.code !== 1000) {
                    // Other non-normal closes - attempt reconnect
                    this.attemptReconnect();
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.updateConnectionStatus('error');
            this.attemptReconnect();
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showToast('Connection failed. Please refresh the page.', 'error');
            return;
        }

        this.reconnectAttempts++;
        this.updateConnectionStatus('reconnecting');
        
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    handleMessage(data) {
        switch (data.type) {
            case 'initial_state':
                this.handleInitialState(data.data);
                break;
            case 'queue_update':
                this.updateQueue(data.queue);
                break;
            case 'status_update':
                this.updateStatus(data.status);
                break;
            case 'output_update':
                this.appendOutput(data.output, data.timestamp);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    handleInitialState(data) {
        this.updateStatus(data.status);
        this.updateQueue(data.queue);
        if (data.output) {
            this.setOutput(data.output);
        }
    }

    updateConnectionStatus(status) {
        const connectionStatus = document.getElementById('connection-status');
        const connectionIndicator = document.getElementById('connection-indicator');
        
        connectionStatus.setAttribute('data-status', status);
        
        const statusTexts = {
            connecting: 'Connecting...',
            connected: 'Connected',
            disconnected: 'Disconnected',
            reconnecting: 'Reconnecting...',
            error: 'Connection Error'
        };
        
        const statusText = statusTexts[status] || 'Unknown';
        connectionStatus.querySelector('.status-text').textContent = statusText;
        
        if (connectionIndicator) {
            connectionIndicator.querySelector('.status-text').textContent = statusText;
        }
    }

    updateStatus(status) {
        // Update session status icon
        const sessionStatus = document.getElementById('session-status');
        const sessionIcon = sessionStatus.querySelector('.session-icon');
        
        if (status.isRunning && status.processingQueue) {
            sessionIcon.textContent = '▶️';
            sessionStatus.setAttribute('data-status', 'running');
        } else if (status.sessionReady) {
            sessionIcon.textContent = '⏸️';
            sessionStatus.setAttribute('data-status', 'paused');
        } else {
            sessionIcon.textContent = '⏹️';
            sessionStatus.setAttribute('data-status', 'idle');
        }

        // Update workspace info if available
        if (status.workspace) {
            this.updateWorkspaceInfo(status.workspace);
        }

        // Update control buttons
        this.updateControlButtons(status);
    }

    updateWorkspaceInfo(workspace) {
        const workspaceElement = document.getElementById('workspace-name');
        if (workspaceElement && workspace.name) {
            workspaceElement.textContent = workspace.name;
            workspaceElement.title = workspace.path; // Show full path on hover
        }
    }

    updateControlButtons(status) {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const interruptBtn = document.getElementById('interrupt-btn');
        const resetBtn = document.getElementById('reset-btn');
        
        startBtn.disabled = status.isRunning && status.processingQueue;
        stopBtn.disabled = !status.isRunning && !status.processingQueue;
        // Interrupt should be enabled when Claude process is running, even if not fully ready
        interruptBtn.disabled = !status.isRunning;
        resetBtn.disabled = false;
    }

    updateQueue(queue) {
        const queueContainer = document.getElementById('queue-container');
        const queueCounter = document.getElementById('queue-counter');
        const totalMessages = document.getElementById('total-messages');
        
        // Update counters
        queueCounter.textContent = queue.length;
        queueCounter.setAttribute('data-count', queue.length);
        if (totalMessages) {
            totalMessages.textContent = queue.length;
        }
        
        // Clear and rebuild queue
        queueContainer.innerHTML = '';
        
        if (queue.length === 0) {
            queueContainer.innerHTML = `
                <div class="empty-state">
                    <p style="text-align: center; color: var(--text-muted); padding: var(--space-lg);">
                        No messages in queue. Add a message to get started.
                    </p>
                </div>
            `;
            return;
        }
        
        queue.forEach(message => {
            const queueItem = this.createQueueItem(message);
            queueContainer.appendChild(queueItem);
        });
    }

    createQueueItem(message) {
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.setAttribute('data-status', message.status);
        item.setAttribute('data-id', message.id);
        
        const statusEmojis = {
            pending: '⏳',
            processing: '⚡',
            completed: '✅',
            error: '❌',
            waiting: '⏱️'
        };
        
        const statusNames = {
            pending: 'Pending',
            processing: 'Processing',
            completed: 'Completed',
            error: 'Error',
            waiting: 'Waiting'
        };
        
        item.innerHTML = `
            <div class="item-content">
                <div class="item-text">${this.escapeHtml(message.text)}</div>
                <div class="item-meta">
                    <span class="item-time">${this.formatRelativeTime(message.timestamp)}</span>
                    <span class="item-status">${statusEmojis[message.status] || ''} ${statusNames[message.status] || message.status}</span>
                </div>
            </div>
            <div class="item-actions">
                <button class="item-action" data-action="edit" title="Edit">✏️</button>
                <button class="item-action" data-action="duplicate" title="Duplicate">📋</button>
                <button class="item-action" data-action="delete" title="Delete">🗑️</button>
            </div>
        `;
        
        // Add event listeners for actions
        item.querySelectorAll('.item-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                this.handleQueueItemAction(message.id, action);
            });
        });
        
        return item;
    }

    handleQueueItemAction(messageId, action) {
        switch (action) {
            case 'edit':
                this.editMessage(messageId);
                break;
            case 'duplicate':
                this.duplicateMessage(messageId);
                break;
            case 'delete':
                this.deleteMessage(messageId);
                break;
        }
    }

    async handleControlAction(action) {
        this.showLoading();
        
        try {
            const response = await fetch(`/api/control/${action}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to ${action}`);
            }
            
            const result = await response.json();
            this.showToast(`Successfully ${action}ed Claude Autopilot`, 'success');
        } catch (error) {
            console.error(`Control action ${action} failed:`, error);
            this.showToast(`Failed to ${action} Claude Autopilot`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    showAddMessageModal() {
        const modal = document.getElementById('add-message-modal');
        const input = document.getElementById('message-input');
        
        input.value = '';
        modal.classList.add('active');
        input.focus();
        
        // Add keyboard handler for Cmd+Enter to send message
        const keyHandler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.addMessage();
            }
        };
        
        input.addEventListener('keydown', keyHandler);
        
        // Remove the handler when modal is closed
        const originalHide = this.hideAddMessageModal.bind(this);
        this.hideAddMessageModal = () => {
            input.removeEventListener('keydown', keyHandler);
            this.hideAddMessageModal = originalHide;
            originalHide();
        };
    }

    hideAddMessageModal() {
        const modal = document.getElementById('add-message-modal');
        modal.classList.remove('active');
    }

    async addMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message) {
            this.showToast('Please enter a message', 'warning');
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch('/api/queue/add', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });
            
            if (!response.ok) {
                throw new Error('Failed to add message');
            }
            
            this.hideAddMessageModal();
            this.showToast('Message added to queue', 'success');
        } catch (error) {
            console.error('Failed to add message:', error);
            this.showToast('Failed to add message', 'error');
        } finally {
            this.hideLoading();
        }
    }

    editMessage(messageId) {
        // Find the message in the current queue display
        const queueItem = document.querySelector(`[data-id="${messageId}"]`);
        if (!queueItem) return;
        
        const messageText = queueItem.querySelector('.item-text').textContent;
        const modal = document.getElementById('edit-message-modal');
        const input = document.getElementById('edit-message-input');
        
        this.currentEditingMessageId = messageId;
        input.value = messageText;
        modal.classList.add('active');
        input.focus();
        
        // Add keyboard handler for Cmd+Enter to save message
        const keyHandler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.saveEditMessage();
            }
        };
        
        input.addEventListener('keydown', keyHandler);
        
        // Remove the handler when modal is closed
        const originalHide = this.hideEditMessageModal.bind(this);
        this.hideEditMessageModal = () => {
            input.removeEventListener('keydown', keyHandler);
            this.hideEditMessageModal = originalHide;
            originalHide();
        };
    }

    hideEditMessageModal() {
        const modal = document.getElementById('edit-message-modal');
        modal.classList.remove('active');
        this.currentEditingMessageId = null;
    }

    async saveEditMessage() {
        if (!this.currentEditingMessageId) return;
        
        const input = document.getElementById('edit-message-input');
        const newText = input.value.trim();
        
        if (!newText) {
            this.showToast('Please enter a message', 'warning');
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${this.currentEditingMessageId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: newText })
            });
            
            if (!response.ok) {
                throw new Error('Failed to edit message');
            }
            
            this.hideEditMessageModal();
            this.showToast('Message updated', 'success');
        } catch (error) {
            console.error('Failed to edit message:', error);
            this.showToast('Failed to edit message', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async duplicateMessage(messageId) {
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${messageId}/duplicate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to duplicate message');
            }
            
            this.showToast('Message duplicated', 'success');
        } catch (error) {
            console.error('Failed to duplicate message:', error);
            this.showToast('Failed to duplicate message', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message?')) {
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${messageId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete message');
            }
            
            this.showToast('Message deleted', 'success');
        } catch (error) {
            console.error('Failed to delete message:', error);
            this.showToast('Failed to delete message', 'error');
        } finally {
            this.hideLoading();
        }
    }

    // Mobile version of appendToClaudeOutput (exactly like main extension)
    appendOutput(output, timestamp) {
        try {
            // Store the latest output
            this.pendingClaudeOutput = output;
            
            // Check if we need to throttle
            const now = Date.now();
            const timeSinceLastRender = now - this.lastClaudeRenderTime;
            
            if (timeSinceLastRender >= this.CLAUDE_RENDER_THROTTLE_MS) {
                // Enough time has passed, render immediately
                console.log('🎨 Rendering Claude output immediately');
                this.renderClaudeOutput();
            } else {
                // Schedule a delayed render if not already scheduled
                if (!this.claudeRenderTimer) {
                    const delay = this.CLAUDE_RENDER_THROTTLE_MS - timeSinceLastRender;
                    console.log(`⏰ Throttling Claude render for ${delay}ms`);
                    this.claudeRenderTimer = setTimeout(() => {
                        this.renderClaudeOutput();
                    }, delay);
                } else {
                    console.log('🔄 Claude render already scheduled, updating pending output');
                }
            }
        } catch (error) {
            console.error('Error appending to Claude output:', error);
        }
    }

    renderClaudeOutput() {
        if (!this.pendingClaudeOutput) {
            return;
        }
        
        const output = this.pendingClaudeOutput;
        this.pendingClaudeOutput = null;
        this.lastClaudeRenderTime = Date.now();
        
        // Clear the timer
        if (this.claudeRenderTimer) {
            clearTimeout(this.claudeRenderTimer);
            this.claudeRenderTimer = null;
        }
        
        console.log(`🎨 Rendering Claude output (${output.length} chars)`);
        
        // Now perform the actual rendering
        this.performClaudeRender(output);
    }

    setOutput(output) {
        if (output) {
            // Use the same throttling mechanism as appendOutput
            this.appendOutput(output);
        } else {
            const outputStream = document.getElementById('claude-output');
            outputStream.innerHTML = '<div class="output-line" data-type="system">📱 Mobile interface ready...</div>';
        }
    }

    // Exact same logic as main extension's performClaudeRender
    performClaudeRender(output) {
        try {
            const claudeOutput = document.getElementById('claude-output');
            
            if (!claudeOutput) {
                console.error('Claude output container not found');
                return;
            }

            // Clear any ready message on first output
            if (claudeOutput.innerHTML.includes('Mobile interface ready')) {
                claudeOutput.innerHTML = '';
                this.claudeContent = '';
                this.lastRenderedContent = '';
                
                // Reset parsing cache
                this.lastParsedContent = '';
                this.lastParsedHtml = '';
            }

            // Check if this output contains screen clearing commands (like main extension)
            if (output.includes('\x1b[2J') || output.includes('\x1b[3J') || output.includes('\x1b[H')) {
                // Clear screen - replace entire content
                this.claudeContent = output;
                this.lastRenderedContent = output;
                claudeOutput.innerHTML = '';
                
                // Reset cache since this is a new screen
                this.lastParsedContent = '';
                this.lastParsedHtml = '';
                
                // Parse and render the new content (remove clear screen codes after detection)
                const contentToRender = this.claudeContent.replace(/\x1b\[[2-3]J/g, '').replace(/\x1b\[H/g, '');
                const htmlOutput = this.parseAnsiToHtml(contentToRender);
                this.lastParsedContent = output;
                this.lastParsedHtml = htmlOutput;
                
                const outputElement = document.createElement('div');
                outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
                outputElement.innerHTML = htmlOutput;
                claudeOutput.appendChild(outputElement);
            } else {
                // No clear screen - this is the complete current screen content from backend
                // Only update if content has actually changed
                if (output !== this.lastRenderedContent) {
                    this.claudeContent = output;
                    this.lastRenderedContent = output;
                    
                    // Use cached parsing if content hasn't changed significantly
                    let htmlOutput;
                    if (output === this.lastParsedContent && this.lastParsedHtml) {
                        htmlOutput = this.lastParsedHtml;
                        console.log('📋 Using cached ANSI parsing result');
                    } else {
                        // Parse and cache the result
                        htmlOutput = this.parseAnsiToHtml(this.claudeContent);
                        this.lastParsedContent = output;
                        this.lastParsedHtml = htmlOutput;
                        console.log('🔄 Parsing ANSI content');
                    }
                    
                    // Replace the entire content safely
                    claudeOutput.innerHTML = '';
                    const outputElement = document.createElement('div');
                    outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
                    outputElement.innerHTML = htmlOutput;
                    claudeOutput.appendChild(outputElement);
                }
            }

            // Auto-scroll to bottom
            this.scrollOutputToBottom();
        } catch (error) {
            console.error('Error rendering Claude output:', error);
        }
    }

    clearOutput() {
        const outputStream = document.getElementById('claude-output');
        outputStream.innerHTML = '';
        
        // Reset state like main extension
        this.claudeContent = '';
        this.lastRenderedContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        
        outputStream.innerHTML = '<div class="output-line" data-type="system">📱 Mobile interface ready...</div>';
    }

    toggleScrollLock() {
        this.isScrollLocked = !this.isScrollLocked;
        const btn = document.getElementById('scroll-lock-btn');
        btn.classList.toggle('active', this.isScrollLocked);
        btn.title = this.isScrollLocked ? 'Unlock scroll' : 'Lock scroll';
        
        if (!this.isScrollLocked) {
            this.scrollOutputToBottom();
        }
    }

    scrollOutputToBottom() {
        if (this.isScrollLocked) return;
        
        const outputContainer = document.querySelector('.output-container');
        if (outputContainer) {
            outputContainer.scrollTop = outputContainer.scrollHeight;
        }
    }

    toggleSection(sectionName) {
        const toggle = document.getElementById(`${sectionName}-toggle`);
        const content = document.getElementById(`${sectionName}-content`);
        const icon = toggle.querySelector('.toggle-icon');
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        const newState = !isExpanded;
        
        toggle.setAttribute('data-expanded', newState);
        content.style.display = newState ? 'block' : 'none';
        icon.textContent = newState ? '▼' : '▶';
    }

    // Touch gesture handling
    handleTouchStart(e) {
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;
        
        // Start long press timer
        this.longPressTimeout = setTimeout(() => {
            if (!this.isSwiping) {
                this.handleLongPress(queueItem);
            }
        }, this.longPressDelay);
    }

    handleTouchMove(e) {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.touches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        
        // Check if this is a horizontal swipe
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 20) {
            e.preventDefault();
            this.isSwiping = true;
            
            queueItem.classList.add('swiping');
            queueItem.style.transform = `translateX(${deltaX}px)`;
            
            // Show swipe indicators
            if (deltaX < -50) {
                queueItem.classList.add('swipe-left');
                queueItem.classList.remove('swipe-right');
            } else if (deltaX > 50) {
                queueItem.classList.add('swipe-right');
                queueItem.classList.remove('swipe-left');
            } else {
                queueItem.classList.remove('swipe-left', 'swipe-right');
            }
        }
    }

    handleTouchEnd(e) {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaTime = Date.now() - this.touchStartTime;
        
        // Reset swipe classes
        queueItem.classList.remove('swiping', 'swipe-left', 'swipe-right');
        queueItem.style.transform = '';
        
        if (this.isSwiping && Math.abs(deltaX) > this.swipeThreshold) {
            const messageId = queueItem.getAttribute('data-id');
            
            if (deltaX < -this.swipeThreshold) {
                // Swipe left - delete
                this.handleQueueItemAction(messageId, 'delete');
            } else if (deltaX > this.swipeThreshold) {
                // Swipe right - duplicate
                this.handleQueueItemAction(messageId, 'duplicate');
            }
        }
        
        this.isSwiping = false;
    }

    handleLongPress(queueItem) {
        const messageId = queueItem.getAttribute('data-id');
        this.handleQueueItemAction(messageId, 'edit');
        
        // Haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    handleKeydown(e) {
        // Keyboard shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    this.showAddMessageModal();
                    break;
                case 'r':
                    e.preventDefault();
                    this.handleControlAction('start');
                    break;
                case 's':
                    e.preventDefault();
                    this.handleControlAction('stop');
                    break;
                case 'i':
                    e.preventDefault();
                    this.handleControlAction('interrupt');
                    break;
            }
        }
        
        // Modal handling and interrupt
        if (e.key === 'Escape') {
            // If modals are open, close them first
            const addModal = document.getElementById('add-message-modal');
            const editModal = document.getElementById('edit-message-modal');
            
            if (addModal.style.display === 'flex' || editModal.style.display === 'flex') {
                this.hideAddMessageModal();
                this.hideEditMessageModal();
            } else {
                // If no modals are open, send interrupt to Claude
                this.handleControlAction('interrupt');
            }
        }
    }

    handleOnline() {
        this.showToast('Connection restored', 'success');
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connect();
        }
    }

    handleOffline() {
        this.showToast('Connection lost', 'warning');
        this.updateConnectionStatus('disconnected');
    }

    // Utility functions
    showLoading() {
        document.getElementById('loading-overlay').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.remove('active');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ANSI Color palette for 256-color mode (copied from main extension)
    getAnsiColors() {
        return {
            // Standard colors (0-15)
            0: '#000000', 1: '#cd0000', 2: '#00cd00', 3: '#cdcd00', 4: '#0000ee', 5: '#cd00cd', 6: '#00cdcd', 7: '#e5e5e5',
            8: '#7f7f7f', 9: '#ff0000', 10: '#00ff00', 11: '#ffff00', 12: '#5c5cff', 13: '#ff00ff', 14: '#00ffff', 15: '#ffffff',
            // More colors including common Claude colors
            52: '#5f0000', 88: '#870000', 124: '#af0000', 160: '#d70000', 196: '#ff0000',
            114: '#87d787', 118: '#87ff00', 148: '#afd700', 154: '#afff00', 190: '#d7ff00',
            174: '#d787af', 175: '#d787d7', 176: '#d787ff', 177: '#d7af5f', 178: '#d7af87',
            179: '#d7afaf', 180: '#d7afd7', 181: '#d7afff', 182: '#d7d75f', 183: '#d7d787',
            184: '#d7d7af', 185: '#d7d7d7', 186: '#d7d7ff', 187: '#d7ff5f', 188: '#d7ff87',
            189: '#d7ffaf', 190: '#d7ffd7', 191: '#d7ffff', 192: '#ff5f5f', 193: '#ff5f87',
            194: '#ff5faf', 195: '#ff5fd7', 196: '#ff5fff', 197: '#ff875f', 198: '#ff8787',
            199: '#ff87af', 200: '#ff87d7', 201: '#ff87ff', 202: '#ffaf5f', 203: '#ffaf87',
            204: '#ffafaf', 205: '#ffafd7', 206: '#ffafff', 207: '#ffd75f', 208: '#ffd787',
            209: '#ffd7af', 210: '#ffd7d7', 211: '#ffd7ff', 212: '#ffff5f', 213: '#ffff87',
            214: '#ffffaf', 215: '#ffffd7', 216: '#ffffff',
            // Claude specific colors
            220: '#ffd700', 231: '#ffffff', 244: '#808080', 246: '#949494',
            // Grays and commonly used colors
            232: '#080808', 233: '#121212', 234: '#1c1c1c', 235: '#262626', 236: '#303030', 237: '#3a3a3a',
            238: '#444444', 239: '#4e4e4e', 240: '#585858', 241: '#626262', 242: '#6c6c6c', 243: '#767676',
            244: '#808080', 245: '#8a8a8a', 246: '#949494', 247: '#9e9e9e', 248: '#a8a8a8', 249: '#b2b2b2',
            250: '#bcbcbc', 251: '#c6c6c6', 252: '#d0d0d0', 253: '#dadada', 254: '#e4e4e4', 255: '#eeeeee'
        };
    }

    parseAnsiToHtml(text) {
        // Remove cursor control sequences that don't affect display
        text = text.replace(/\x1b\[\?25[lh]/g, ''); // Show/hide cursor
        text = text.replace(/\x1b\[\?2004[lh]/g, ''); // Bracketed paste mode
        text = text.replace(/\x1b\[\?1004[lh]/g, ''); // Focus reporting
        // Don't remove clear screen codes - let performClaudeRender detect them
        // text = text.replace(/\x1b\[[2-3]J/g, ''); // Clear screen codes
        text = text.replace(/\x1b\[H/g, ''); // Move cursor to home

        // Process the text line by line to handle carriage returns properly
        const lines = text.split('\n');
        const processedLines = [];

        for (let lineText of lines) {
            // Handle carriage returns within the line
            const parts = lineText.split('\r');
            let finalLine = '';

            for (let i = 0; i < parts.length; i++) {
                if (i === parts.length - 1) {
                    // Last part - append normally
                    finalLine += this.processAnsiInText(parts[i]);
                } else {
                    // Not the last part - this will be overwritten by the next part
                    finalLine = this.processAnsiInText(parts[i]);
                }
            }

            processedLines.push(finalLine);
        }

        return processedLines.join('\n');
    }

    processAnsiInText(text) {
        let html = '';
        let currentStyles = {
            color: null,
            bold: false,
            italic: false,
            dim: false,
            reverse: false
        };

        const ansiColors = this.getAnsiColors();

        // Split text into parts: text and ANSI escape sequences
        const parts = text.split(/(\x1b\[[0-9;]*m)/);

        for (let part of parts) {
            if (part.startsWith('\x1b[') && part.endsWith('m')) {
                // This is an ANSI color/style code
                const codes = part.slice(2, -1).split(';').filter(c => c !== '').map(Number);

                for (const code of codes) {
                    if (code === 0 || code === 39) {
                        // Reset or default foreground color
                        currentStyles.color = null;
                        currentStyles.bold = false;
                        currentStyles.italic = false;
                        currentStyles.dim = false;
                        currentStyles.reverse = false;
                    } else if (code === 1) {
                        currentStyles.bold = true;
                    } else if (code === 22) {
                        currentStyles.bold = false;
                        currentStyles.dim = false;
                    } else if (code === 2) {
                        currentStyles.dim = true;
                    } else if (code === 3) {
                        currentStyles.italic = true;
                    } else if (code === 23) {
                        currentStyles.italic = false;
                    } else if (code === 7) {
                        currentStyles.reverse = true;
                    } else if (code === 27) {
                        currentStyles.reverse = false;
                    }
                }

                // Handle 256-color mode (38;5;n)
                for (let j = 0; j < codes.length - 2; j++) {
                    if (codes[j] === 38 && codes[j + 1] === 5) {
                        const colorCode = codes[j + 2];
                        currentStyles.color = ansiColors[colorCode] || '#ffffff';
                        break;
                    }
                }
            } else if (part.length > 0) {
                // This is actual text content - sanitize it
                let style = '';
                if (currentStyles.color) style += `color: ${currentStyles.color};`;
                if (currentStyles.bold) style += 'font-weight: bold;';
                if (currentStyles.italic) style += 'font-style: italic;';
                if (currentStyles.dim) style += 'opacity: 0.6;';
                if (currentStyles.reverse) style += 'background-color: #ffffff; color: #000000;';

                // Sanitize HTML characters
                const escapedText = this.escapeHtml(part);

                if (style) {
                    html += `<span style="${style}">${escapedText}</span>`;
                } else {
                    html += escapedText;
                }
            }
        }

        return html;
    }

    sanitizeHtml(text) {
        return this.escapeHtml(text);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    formatRelativeTime(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diff = now - date;
        
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'just now';
    }

    updateCurrentTime() {
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = this.formatTime(Date.now());
        }
    }
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// ===== FILE EXPLORER CLASS =====

class FileExplorer {
    constructor() {
        console.log('🚀 FileExplorer: Initializing...');
        this.expandedFolders = new Set();
        this.fileTree = null;
        this.currentPath = '';
        this.isLoading = false;
        
        // Cache for performance
        this.treeCache = new Map();
        this.contentCache = new Map();
        
        console.log('🚀 FileExplorer: Setting up event listeners...');
        this.initializeEventListeners();
        
        console.log('🚀 FileExplorer: Initialized (file tree will load when expanded)');
    }

    initializeEventListeners() {
        // Explorer toggle
        const explorerToggle = document.getElementById('explorer-toggle');
        if (explorerToggle) {
            explorerToggle.addEventListener('click', () => this.toggleExplorer());
        }

        // Control buttons
        const refreshBtn = document.getElementById('refresh-files');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshFileTree());
        }

        const searchBtn = document.getElementById('search-files');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.openSearch());
        }

        // File preview modal
        const closePreview = document.getElementById('close-preview');
        if (closePreview) {
            closePreview.addEventListener('click', () => this.closePreview());
        }

        const copyPath = document.getElementById('copy-file-path');
        if (copyPath) {
            copyPath.addEventListener('click', () => this.copyCurrentFilePath());
        }

        // Search modal
        const closeSearch = document.getElementById('close-search');
        if (closeSearch) {
            closeSearch.addEventListener('click', () => this.closeSearch());
        }

        const performSearch = document.getElementById('perform-search');
        if (performSearch) {
            performSearch.addEventListener('click', () => this.performSearch());
        }

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        // Modal backdrop clicks
        const previewModal = document.getElementById('file-preview-modal');
        if (previewModal) {
            previewModal.addEventListener('click', (e) => {
                if (e.target === previewModal) {
                    this.closePreview();
                }
            });
        }

        const searchModal = document.getElementById('file-search-modal');
        if (searchModal) {
            searchModal.addEventListener('click', (e) => {
                if (e.target === searchModal) {
                    this.closeSearch();
                }
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePreview();
                this.closeSearch();
            }
        });
    }

    toggleExplorer() {
        const content = document.getElementById('explorer-content');
        const toggle = document.getElementById('explorer-toggle');
        const toggleIcon = toggle?.querySelector('.toggle-icon');
        
        if (!content || !toggle) return;
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        
        if (isExpanded) {
            content.style.display = 'none';
            toggle.setAttribute('data-expanded', 'false');
            if (toggleIcon) toggleIcon.textContent = '▶';
        } else {
            content.style.display = 'block';
            toggle.setAttribute('data-expanded', 'true');
            if (toggleIcon) toggleIcon.textContent = '▼';
            
            // Load file tree if not already loaded
            if (!this.fileTree) {
                this.loadFileTree();
            }
        }
    }

    async loadFileTree(path = '') {
        console.log('🌳 FileExplorer: Loading file tree for path:', path);
        
        if (this.isLoading) {
            console.log('🌳 FileExplorer: Already loading, skipping');
            return;
        }
        
        this.isLoading = true;
        this.showLoading(true);
        
        try {
            // Check cache first
            const cacheKey = path || 'root';
            if (this.treeCache.has(cacheKey)) {
                console.log('🌳 FileExplorer: Using cached data for', cacheKey);
                const cachedData = this.treeCache.get(cacheKey);
                this.renderFileTree(cachedData.items);
                this.updateFileCounter(cachedData.total);
                this.showLoading(false);
                this.isLoading = false;
                return;
            }

            const url = `/api/files/tree?path=${encodeURIComponent(path)}&maxDepth=3`;
            console.log('🌳 FileExplorer: Fetching from URL:', url);
            console.log('🌳 FileExplorer: Auth token:', window.CLAUDE_AUTH_TOKEN ? 'Present' : 'Missing');
            console.log('🌳 FileExplorer: Session token:', this.getSessionToken() || 'Missing');

            const response = await fetch(url, {
                headers: { 
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                    'x-session-token': this.getSessionToken()
                }
            });

            console.log('🌳 FileExplorer: Response status:', response.status);
            console.log('🌳 FileExplorer: Response ok:', response.ok);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('🌳 FileExplorer: Error response:', errorText);
                throw new Error(`Failed to load file tree: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('🌳 FileExplorer: Received data:', data);
            
            // Cache the result
            this.treeCache.set(cacheKey, data);
            
            this.fileTree = data.items;
            this.currentPath = path;
            console.log('🌳 FileExplorer: Rendering', data.items?.length || 0, 'items');
            this.renderFileTree(data.items);
            this.updateFileCounter(data.total);
            
        } catch (error) {
            console.error('🌳 FileExplorer: Error loading file tree:', error);
            this.showError('Failed to load file tree: ' + error.message);
        } finally {
            this.showLoading(false);
            this.isLoading = false;
        }
    }

    renderFileTree(items, container = null, level = 0) {
        console.log('🎨 FileExplorer: Rendering file tree with', items?.length || 0, 'items at level', level);
        
        if (!container) {
            container = document.getElementById('file-tree');
            if (!container) {
                console.error('🎨 FileExplorer: file-tree container not found!');
                return;
            }
            container.innerHTML = '';
            console.log('🎨 FileExplorer: Cleared container, found element:', container);
        }

        if (!items || items.length === 0) {
            console.log('🎨 FileExplorer: No items to render, showing empty state');
            this.showEmptyState();
            return;
        }

        console.log('🎨 FileExplorer: Hiding empty state and rendering items');
        this.hideEmptyState();

        items.forEach((item, index) => {
            console.log(`🎨 FileExplorer: Rendering item ${index + 1}:`, item.name, item.type);
            const fileItem = this.createFileItem(item, level);
            container.appendChild(fileItem);

            if (item.type === 'directory' && item.children && this.expandedFolders.has(item.path)) {
                this.renderFileTree(item.children, container, level + 1);
            }
        });
        
        console.log('🎨 FileExplorer: Finished rendering, container has', container.children.length, 'children');
    }

    createFileItem(item, level) {
        const div = document.createElement('div');
        div.className = `file-item ${item.type}`;
        div.setAttribute('data-path', item.path);
        div.setAttribute('data-type', item.type);

        const indent = document.createElement('div');
        indent.className = 'file-indent';
        indent.style.width = `${level * 20}px`;

        const expand = document.createElement('div');
        expand.className = 'file-expand';
        if (item.type === 'directory') {
            expand.textContent = this.expandedFolders.has(item.path) ? '▼' : '▶';
            expand.classList.toggle('expanded', this.expandedFolders.has(item.path));
        }

        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = this.getFileIcon(item);

        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = item.name;

        const meta = document.createElement('div');
        meta.className = 'file-meta';
        if (item.type === 'file' && item.size !== undefined) {
            meta.textContent = this.formatFileSize(item.size);
        }

        div.appendChild(indent);
        if (item.type === 'directory') {
            div.appendChild(expand);
        }
        div.appendChild(icon);
        div.appendChild(name);
        div.appendChild(meta);

        // Event handlers
        if (item.type === 'directory') {
            expand.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFolder(item.path);
            });
            
            div.addEventListener('click', () => {
                this.toggleFolder(item.path);
            });
        } else {
            div.addEventListener('click', () => {
                this.previewFile(item.path);
            });
        }

        return div;
    }

    toggleFolder(folderPath) {
        if (this.expandedFolders.has(folderPath)) {
            this.expandedFolders.delete(folderPath);
        } else {
            this.expandedFolders.add(folderPath);
        }
        
        // Re-render the tree to show/hide children
        this.renderFileTree(this.fileTree);
    }

    getFileIcon(item) {
        if (item.type === 'directory') {
            return this.expandedFolders.has(item.path) ? '📂' : '📁';
        }
        
        const icons = {
            '.js': '🟨', '.jsx': '🟨', '.ts': '🔷', '.tsx': '🔷',
            '.json': '📄', '.md': '📝', '.css': '🎨', '.scss': '🎨',
            '.html': '🌐', '.htm': '🌐', '.py': '🐍', '.java': '☕',
            '.cpp': '⚙️', '.c': '⚙️', '.h': '⚙️', '.hpp': '⚙️',
            '.sh': '📜', '.bash': '📜', '.zsh': '📜',
            '.yml': '⚙️', '.yaml': '⚙️', '.xml': '📄',
            '.svg': '🖼️', '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
            '.gif': '🖼️', '.pdf': '📕', '.txt': '📄', '.log': '📄',
            '.env': '⚙️', '.gitignore': '📄', '.dockerfile': '🐳'
        };
        
        return icons[item.extension] || '📄';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async previewFile(filePath) {
        if (!filePath) return;
        
        this.currentFilePath = filePath;
        this.showPreviewModal();
        this.showPreviewLoading(true);
        
        try {
            // Check cache first
            if (this.contentCache.has(filePath)) {
                const cachedContent = this.contentCache.get(filePath);
                this.displayFileContent(cachedContent);
                this.showPreviewLoading(false);
                return;
            }

            const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`, {
                headers: { 
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                    'x-session-token': this.getSessionToken()
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            // Cache the content
            this.contentCache.set(filePath, data);
            
            this.displayFileContent(data);
            
        } catch (error) {
            console.error('Error loading file content:', error);
            this.showPreviewError(error.message);
        } finally {
            this.showPreviewLoading(false);
        }
    }

    displayFileContent(data) {
        const nameElement = document.getElementById('preview-file-name');
        const sizeElement = document.getElementById('preview-file-size');
        const linesElement = document.getElementById('preview-file-lines');
        const modifiedElement = document.getElementById('preview-file-modified');
        const codeElement = document.getElementById('preview-code-content');

        if (nameElement) {
            const fileName = this.currentFilePath.split('/').pop();
            nameElement.textContent = fileName || 'Unknown File';
        }

        if (sizeElement) {
            sizeElement.textContent = this.formatFileSize(data.size);
        }

        if (linesElement) {
            linesElement.textContent = `${data.lines} lines`;
        }

        if (modifiedElement) {
            const date = new Date(data.modified).toLocaleDateString();
            modifiedElement.textContent = `Modified: ${date}`;
        }

        if (codeElement) {
            codeElement.textContent = data.content;
            codeElement.className = `language-${data.language}`;
            
            // Basic syntax highlighting for common cases
            this.applySyntaxHighlighting(codeElement, data.language);
        }

        this.hidePreviewError();
    }

    applySyntaxHighlighting(element, language) {
        // Basic syntax highlighting - in production you'd want a proper library
        const content = element.textContent;
        let highlightedContent = content;

        // Basic highlighting for common languages
        if (language === 'javascript' || language === 'typescript') {
            highlightedContent = content
                .replace(/\b(const|let|var|function|class|if|else|return|import|export|from|async|await)\b/g, '<span style="color: #569cd6;">$1</span>')
                .replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span style="color: #ce9178;">$&</span>')
                .replace(/\/\/.*$/gm, '<span style="color: #6a9955;">$&</span>');
        } else if (language === 'json') {
            highlightedContent = content
                .replace(/("([^"\\]|\\.)*")(\s*:)/g, '<span style="color: #9cdcfe;">$1</span>$3')
                .replace(/:\s*("([^"\\]|\\.)*")/g, ': <span style="color: #ce9178;">$1</span>')
                .replace(/:\s*(\d+)/g, ': <span style="color: #b5cea8;">$1</span>');
        }

        element.innerHTML = highlightedContent;
    }

    // Modal and UI management methods
    showPreviewModal() {
        const modal = document.getElementById('file-preview-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    closePreview() {
        const modal = document.getElementById('file-preview-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    showPreviewLoading(show) {
        const loading = document.getElementById('preview-loading');
        const content = document.getElementById('preview-content');
        if (loading && content) {
            loading.style.display = show ? 'flex' : 'none';
            content.style.display = show ? 'none' : 'block';
        }
    }

    showPreviewError(message) {
        const error = document.getElementById('preview-error');
        const content = document.getElementById('preview-content');
        if (error && content) {
            error.style.display = 'flex';
            error.querySelector('.error-text').textContent = message;
            content.style.display = 'none';
        }
    }

    hidePreviewError() {
        const error = document.getElementById('preview-error');
        if (error) {
            error.style.display = 'none';
        }
    }

    copyCurrentFilePath() {
        if (this.currentFilePath && navigator.clipboard) {
            navigator.clipboard.writeText(this.currentFilePath).then(() => {
                this.showToast('File path copied to clipboard');
            }).catch(() => {
                this.showToast('Failed to copy file path');
            });
        }
    }

    // Search functionality
    openSearch() {
        const modal = document.getElementById('file-search-modal');
        const input = document.getElementById('search-input');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }
    }

    closeSearch() {
        const modal = document.getElementById('file-search-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    async performSearch() {
        const input = document.getElementById('search-input');
        const extensions = document.getElementById('search-extensions');
        
        if (!input) return;
        
        const query = input.value.trim();
        if (!query) return;
        
        const selectedExtensions = extensions?.value || '';
        
        this.showSearchLoading(true);
        
        // For now, show a placeholder - full search implementation would go here
        setTimeout(() => {
            this.showSearchLoading(false);
            this.showSearchResults([]);
        }, 1000);
    }

    showSearchLoading(show) {
        const loading = document.getElementById('search-loading');
        const results = document.getElementById('search-results');
        if (loading && results) {
            loading.style.display = show ? 'flex' : 'none';
            results.style.display = show ? 'none' : 'block';
        }
    }

    showSearchResults(results) {
        const container = document.getElementById('search-results');
        const empty = document.getElementById('search-empty');
        
        if (!container) return;
        
        if (results.length === 0) {
            container.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            return;
        }
        
        if (empty) empty.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '';
        
        results.forEach(result => {
            const item = this.createSearchResultItem(result);
            container.appendChild(item);
        });
    }

    // Utility methods
    refreshFileTree() {
        this.treeCache.clear();
        this.contentCache.clear();
        this.loadFileTree(this.currentPath);
    }

    showLoading(show) {
        const loading = document.getElementById('file-tree-loading');
        const tree = document.getElementById('file-tree');
        if (loading && tree) {
            loading.style.display = show ? 'flex' : 'none';
            tree.style.display = show ? 'none' : 'block';
        }
    }

    showEmptyState() {
        const empty = document.getElementById('file-tree-empty');
        const tree = document.getElementById('file-tree');
        if (empty && tree) {
            empty.style.display = 'flex';
            tree.style.display = 'none';
        }
    }

    hideEmptyState() {
        const empty = document.getElementById('file-tree-empty');
        const tree = document.getElementById('file-tree');
        if (empty && tree) {
            empty.style.display = 'none';
            tree.style.display = 'block';
        }
    }

    showError(message) {
        console.error('FileExplorer Error:', message);
        this.showToast(message);
    }

    updateFileCounter(count) {
        const counter = document.getElementById('file-counter');
        if (counter) {
            counter.textContent = `${count} files`;
            counter.setAttribute('data-count', count);
        }
    }

    getSessionToken() {
        // Get session token from cookie or localStorage
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'sessionToken') {
                return value;
            }
        }
        return null;
    }

    showToast(message) {
        // Use existing toast system if available
        if (window.showToast) {
            window.showToast(message);
        } else {
            console.log('Toast:', message);
        }
    }
}

class GitChanges {
    constructor() {
        this.isExpanded = false;
        this.currentBranch = null;
        this.gitFiles = [];
        this.filteredFiles = [];
        this.refreshInterval = null;
        this.pendingAction = null;
        this.selectedFiles = new Set();
        this.searchVisible = false;
        this.currentSearch = '';
        this.currentFilter = 'all';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadGitStatus();
        
        // Auto-refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (this.isExpanded) {
                this.loadGitStatus();
            }
        }, 30000);
    }

    setupEventListeners() {
        // Toggle git section
        const gitToggle = document.getElementById('git-toggle');
        if (gitToggle) {
            gitToggle.addEventListener('click', () => this.toggleSection());
        }

        // Refresh git status
        const refreshGit = document.getElementById('refresh-git');
        if (refreshGit) {
            refreshGit.addEventListener('click', () => this.loadGitStatus());
        }

        // Branch info button
        const branchInfo = document.getElementById('git-branch-info');
        if (branchInfo) {
            branchInfo.addEventListener('click', () => this.showBranchInfo());
        }

        // Diff viewer modal
        const diffModal = document.getElementById('diff-viewer-modal');
        const closeDiff = document.getElementById('close-diff');
        if (closeDiff) {
            closeDiff.addEventListener('click', () => this.closeDiffViewer());
        }

        // Compare mode change
        const compareMode = document.getElementById('diff-compare-mode');
        if (compareMode) {
            compareMode.addEventListener('change', (e) => {
                this.loadFileDiff(this.currentDiffFile, e.target.value);
            });
        }

        // Copy diff
        const copyDiff = document.getElementById('copy-diff');
        if (copyDiff) {
            copyDiff.addEventListener('click', () => this.copyDiff());
        }

        // Git operations
        const stageAllBtn = document.getElementById('stage-all-btn');
        if (stageAllBtn) {
            stageAllBtn.addEventListener('click', () => this.confirmAction('stage-all'));
        }

        const unstageAllBtn = document.getElementById('unstage-all-btn');
        if (unstageAllBtn) {
            unstageAllBtn.addEventListener('click', () => this.confirmAction('unstage-all'));
        }

        // Help button
        const helpBtn = document.getElementById('git-help-btn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => this.showKeyboardHelp());
        }

        // Performance button
        const performanceBtn = document.getElementById('git-performance-btn');
        if (performanceBtn) {
            performanceBtn.addEventListener('click', () => this.togglePerformanceDashboard());
        }

        // Confirmation modal
        const confirmModal = document.getElementById('git-confirm-modal');
        const closeConfirm = document.getElementById('close-git-confirm');
        const cancelAction = document.getElementById('cancel-git-action');
        const confirmAction = document.getElementById('confirm-git-action');

        if (closeConfirm) {
            closeConfirm.addEventListener('click', () => this.closeConfirmModal());
        }

        if (cancelAction) {
            cancelAction.addEventListener('click', () => this.closeConfirmModal());
        }

        if (confirmAction) {
            confirmAction.addEventListener('click', () => this.executeAction());
        }

        // Search functionality
        const searchToggle = document.getElementById('git-search-toggle');
        if (searchToggle) {
            searchToggle.addEventListener('click', () => this.toggleSearch());
        }

        const searchInput = document.getElementById('git-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.clearSearch();
                }
            });
        }

        const searchClear = document.getElementById('git-search-clear');
        if (searchClear) {
            searchClear.addEventListener('click', () => this.clearSearch());
        }

        // Filter buttons
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const status = e.target.getAttribute('data-status');
                this.setFilter(status);
            });
        });

        // Set default active filter
        const allFilter = document.getElementById('filter-all');
        if (allFilter) {
            allFilter.classList.add('active');
        }

        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    }

    async toggleSection() {
        const toggle = document.getElementById('git-toggle');
        const content = document.getElementById('git-content');
        const icon = toggle.querySelector('.toggle-icon');
        
        this.isExpanded = !this.isExpanded;
        
        if (this.isExpanded) {
            content.style.display = 'block';
            icon.textContent = '▼';
            toggle.setAttribute('data-expanded', 'true');
            toggle.setAttribute('aria-expanded', 'true');
            this.announceToScreenReader('Git changes section expanded');
            await this.loadGitStatus();
        } else {
            content.style.display = 'none';
            icon.textContent = '▶';
            toggle.setAttribute('data-expanded', 'false');
            toggle.setAttribute('aria-expanded', 'false');
            this.announceToScreenReader('Git changes section collapsed');
        }
    }

    async loadGitStatus() {
        if (!this.isExpanded) return;
        
        const startTime = performance.now();
        this.showLoading();
        
        try {
            const response = await fetch('/api/git/status', {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const status = await response.json();
            this.renderGitStatus(status);
            
            // Track performance
            const duration = performance.now() - startTime;
            this.trackPerformance('git-status', duration);
            
        } catch (error) {
            console.error('Error loading git status:', error);
            this.showError('Failed to load git status');
        } finally {
            this.hideLoading();
        }
    }

    renderGitStatus(status) {
        this.currentBranch = status.branch;
        this.gitFiles = status.files;
        
        // Update branch info
        this.renderBranchInfo(status.branch);
        
        // Update file list
        this.renderFileList(status.files, status.isClean);
        
        // Update counter
        this.updateFileCounter(status.files.length);
    }

    renderBranchInfo(branch) {
        const branchName = document.getElementById('branch-name');
        const branchStatus = document.getElementById('branch-status');
        const commitHash = document.getElementById('commit-hash');
        const commitMessage = document.getElementById('commit-message');
        
        if (branchName) branchName.textContent = branch.branch;
        
        if (branchStatus) {
            let statusText = 'up to date';
            if (branch.ahead > 0 && branch.behind > 0) {
                statusText = `${branch.ahead} ahead, ${branch.behind} behind`;
            } else if (branch.ahead > 0) {
                statusText = `${branch.ahead} ahead`;
            } else if (branch.behind > 0) {
                statusText = `${branch.behind} behind`;
            }
            branchStatus.textContent = statusText;
        }
        
        if (commitHash) commitHash.textContent = `#${branch.lastCommit.hash}`;
        if (commitMessage) commitMessage.textContent = branch.lastCommit.message;
    }

    renderFileList(files, isClean) {
        const gitFiles = document.getElementById('git-files');
        const gitClean = document.getElementById('git-clean');
        const gitNoResults = document.getElementById('git-no-results');
        
        if (isClean) {
            gitFiles.style.display = 'none';
            gitClean.style.display = 'flex';
            gitNoResults.style.display = 'none';
            this.updateFileCounter(0);
            return;
        }
        
        // Filter files based on search and status
        this.filteredFiles = this.filterFiles(files);
        
        if (this.filteredFiles.length === 0 && (this.currentSearch || this.currentFilter !== 'all')) {
            // Show no results if we have search/filter but no matches
            gitFiles.style.display = 'none';
            gitClean.style.display = 'none';
            gitNoResults.style.display = 'flex';
        } else if (this.filteredFiles.length === 0) {
            // Show clean state if no files at all
            gitFiles.style.display = 'none';
            gitClean.style.display = 'flex';
            gitNoResults.style.display = 'none';
        } else {
            // Show filtered files
            gitFiles.style.display = 'block';
            gitClean.style.display = 'none';
            gitNoResults.style.display = 'none';
            gitFiles.innerHTML = '';
            
            this.filteredFiles.forEach(file => {
                const fileItem = this.createFileItem(file);
                gitFiles.appendChild(fileItem);
            });
        }
        
        this.updateFileCounter(this.filteredFiles.length);
    }

    createFileItem(file) {
        const item = document.createElement('div');
        item.className = 'git-file-item';
        item.tabIndex = 0; // Make focusable
        item.setAttribute('role', 'listitem');
        item.setAttribute('aria-label', `${file.path}, ${this.getStatusText(file.status, file.staged, file.unstaged)}, ${file.additions || 0} additions, ${file.deletions || 0} deletions`);
        item.addEventListener('click', () => this.showFileDiff(file.path));
        
        // Handle keyboard interaction on individual files
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.showFileDiff(file.path);
            } else if (e.key === 's' && e.ctrlKey) {
                e.preventDefault();
                this.stageFile(file.path);
                // Announce action to screen readers
                this.announceToScreenReader(`Staging ${file.path}`);
            } else if (e.key === 'd' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                this.confirmAction('discard', file.path);
                this.announceToScreenReader(`Discarding changes to ${file.path}`);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.focusNextFileItem(item);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusPreviousFileItem(item);
            }
        });

        // Add swipe gesture support for mobile
        this.addSwipeGestures(item, file);
        
        // Add performance timing
        const startTime = performance.now();
        
        const statusIcon = this.getStatusIcon(file.status);
        const statusClass = `git-file-status--${file.status}`;
        
        // Determine which action buttons to show
        let actionButtons = '';
        
        if (file.unstaged && !file.staged) {
            // Unstaged changes only
            actionButtons = `
                <button class="git-action-btn git-action-btn--stage" onclick="event.stopPropagation(); gitChanges.stageFile('${file.path}')">Stage</button>
                <button class="git-action-btn git-action-btn--discard" onclick="event.stopPropagation(); gitChanges.confirmAction('discard', '${file.path}')">Discard</button>
            `;
        } else if (file.staged && !file.unstaged) {
            // Staged changes only
            actionButtons = `
                <button class="git-action-btn git-action-btn--unstage" onclick="event.stopPropagation(); gitChanges.unstageFile('${file.path}')">Unstage</button>
            `;
        } else if (file.staged && file.unstaged) {
            // Both staged and unstaged changes
            actionButtons = `
                <button class="git-action-btn git-action-btn--stage" onclick="event.stopPropagation(); gitChanges.stageFile('${file.path}')">Stage</button>
                <button class="git-action-btn git-action-btn--unstage" onclick="event.stopPropagation(); gitChanges.unstageFile('${file.path}')">Unstage</button>
                <button class="git-action-btn git-action-btn--discard" onclick="event.stopPropagation(); gitChanges.confirmAction('discard', '${file.path}')">Discard</button>
            `;
        } else {
            // Untracked files
            actionButtons = `
                <button class="git-action-btn git-action-btn--stage" onclick="event.stopPropagation(); gitChanges.stageFile('${file.path}')">Add</button>
                <button class="git-action-btn git-action-btn--discard" onclick="event.stopPropagation(); gitChanges.confirmAction('discard', '${file.path}')">Delete</button>
            `;
        }
        
        item.innerHTML = `
            <div class="git-file-status ${statusClass}">${statusIcon}</div>
            <div class="git-file-info">
                <div class="git-file-path">${file.path}</div>
                <div class="git-file-changes">
                    ${file.additions ? `<span class="git-file-additions">+${file.additions}</span>` : ''}
                    ${file.deletions ? `<span class="git-file-deletions">-${file.deletions}</span>` : ''}
                    <span>${this.getStatusText(file.status, file.staged, file.unstaged)}</span>
                </div>
            </div>
            <div class="git-file-actions">
                ${actionButtons}
                <button class="git-action-btn" onclick="event.stopPropagation(); gitChanges.addToQueue('${file.path}')">Queue</button>
            </div>
        `;
        
        return item;
    }

    getStatusIcon(status) {
        const icons = {
            'modified': 'M',
            'added': 'A',
            'deleted': 'D',
            'renamed': 'R',
            'copied': 'C',
            'untracked': '??'
        };
        return icons[status] || '?';
    }

    getStatusText(status, staged, unstaged) {
        if (staged && unstaged) return 'staged + modified';
        if (staged) return 'staged';
        if (unstaged) return 'modified';
        return status;
    }

    async showFileDiff(filePath, compareMode = 'working') {
        this.currentDiffFile = filePath;
        
        const modal = document.getElementById('diff-viewer-modal');
        const fileName = document.getElementById('diff-file-name');
        const filePath_el = document.getElementById('diff-file-path');
        
        if (fileName) fileName.textContent = filePath.split('/').pop();
        if (filePath_el) filePath_el.textContent = filePath;
        
        modal.style.display = 'flex';
        
        await this.loadFileDiff(filePath, compareMode);
    }

    async loadFileDiff(filePath, compareMode = 'working') {
        const startTime = performance.now();
        this.showDiffLoading();
        
        try {
            const response = await fetch(`/api/git/file-diff/${encodeURIComponent(filePath)}?compare=${compareMode}`, {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const diff = await response.json();
            this.renderDiff(diff);
            
            // Track performance
            const duration = performance.now() - startTime;
            this.trackPerformance('file-diff', duration);
            
        } catch (error) {
            console.error('Error loading diff:', error);
            this.showDiffError('Failed to load diff');
        } finally {
            this.hideDiffLoading();
        }
    }

    renderDiff(diff) {
        // Update stats
        const additions = document.getElementById('diff-additions');
        const deletions = document.getElementById('diff-deletions');
        const fileType = document.getElementById('diff-file-type');
        
        if (additions) additions.textContent = `+${diff.additions}`;
        if (deletions) deletions.textContent = `-${diff.deletions}`;
        if (fileType) fileType.textContent = diff.isBinary ? 'binary' : 'text';
        
        // Render diff lines
        const diffLines = document.getElementById('diff-lines');
        if (diffLines) {
            diffLines.innerHTML = '';
            
            if (diff.isBinary) {
                diffLines.innerHTML = '<div class="diff-line diff-line--header">Binary file (cannot display diff)</div>';
                return;
            }
            
            diff.lines.forEach((line, index) => {
                const lineEl = this.createDiffLine(line, index);
                diffLines.appendChild(lineEl);
                
                // Add expand control if this is a hunk line with expansion capability
                if (line.type === 'hunk' && lineEl.expandControl) {
                    diffLines.appendChild(lineEl.expandControl);
                }
            });
        }
    }

    createDiffLine(line, index) {
        const lineEl = document.createElement('div');
        lineEl.className = `diff-line diff-line--${line.type}`;
        
        if (line.type === 'header') {
            lineEl.innerHTML = `<span class="diff-line-content">${this.escapeHtml(line.content)}</span>`;
        } else if (line.type === 'hunk') {
            lineEl.innerHTML = `<span class="diff-line-content">${this.escapeHtml(line.content)}</span>`;
            
            // Add expandable controls if this hunk can be expanded
            if (line.expandable) {
                const expandEl = document.createElement('div');
                expandEl.className = 'diff-line diff-line--expand';
                expandEl.innerHTML = `
                    <div class="expand-controls">
                        ${line.expandBefore > 0 ? `<button class="expand-btn" onclick="gitChanges.expandContext(${index}, 'before', ${line.expandBefore})">↑ Expand ${line.expandBefore} lines above</button>` : ''}
                        ${line.expandAfter > 0 ? `<button class="expand-btn" onclick="gitChanges.expandContext(${index}, 'after', ${line.expandAfter})">↓ Expand ${line.expandAfter} lines below</button>` : ''}
                    </div>
                `;
                
                // Insert the expand control after the hunk header
                lineEl.expandControl = expandEl;
            }
        } else {
            const oldNum = line.oldLineNumber ? line.oldLineNumber.toString() : '';
            const newNum = line.newLineNumber ? line.newLineNumber.toString() : '';
            
            lineEl.innerHTML = `
                <span class="diff-line-number">${oldNum}</span>
                <span class="diff-line-number">${newNum}</span>
                <span class="diff-line-content">${this.escapeHtml(line.content)}</span>
            `;
        }
        
        return lineEl;
    }

    closeDiffViewer() {
        const modal = document.getElementById('diff-viewer-modal');
        modal.style.display = 'none';
        this.currentDiffFile = null;
    }

    copyDiff() {
        const diffLines = document.getElementById('diff-lines');
        if (diffLines) {
            const text = Array.from(diffLines.children)
                .map(line => line.textContent)
                .join('\n');
            
            navigator.clipboard.writeText(text).then(() => {
                this.showToast('Diff copied to clipboard');
            }).catch(() => {
                this.showToast('Failed to copy diff');
            });
        }
    }

    viewFile(filePath) {
        // Use file explorer to view file
        if (window.fileExplorer) {
            window.fileExplorer.viewFile(filePath);
        }
    }

    addToQueue(filePath) {
        const message = `Review changes in file: ${filePath}`;
        // Use mobile interface to add message
        if (window.mobileInterface) {
            window.mobileInterface.showAddMessageModal(message);
        }
    }

    showBranchInfo() {
        if (this.currentBranch) {
            const info = `Branch: ${this.currentBranch.branch}\nCommit: ${this.currentBranch.lastCommit.hash}\nAuthor: ${this.currentBranch.lastCommit.author}\nMessage: ${this.currentBranch.lastCommit.message}`;
            this.showToast(info);
        }
    }

    showLoading() {
        const loading = document.getElementById('git-loading');
        const files = document.getElementById('git-files');
        const clean = document.getElementById('git-clean');
        
        if (loading) loading.style.display = 'flex';
        if (files) files.style.display = 'none';
        if (clean) clean.style.display = 'none';
    }

    hideLoading() {
        const loading = document.getElementById('git-loading');
        if (loading) loading.style.display = 'none';
    }

    showDiffLoading() {
        const loading = document.getElementById('diff-loading');
        const content = document.getElementById('diff-content');
        const error = document.getElementById('diff-error');
        
        if (loading) loading.style.display = 'flex';
        if (content) content.style.display = 'none';
        if (error) error.style.display = 'none';
    }

    hideDiffLoading() {
        const loading = document.getElementById('diff-loading');
        const content = document.getElementById('diff-content');
        
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    }

    showDiffError(message) {
        const error = document.getElementById('diff-error');
        const content = document.getElementById('diff-content');
        
        if (error) {
            error.style.display = 'flex';
            error.querySelector('.error-text').textContent = message;
        }
        if (content) content.style.display = 'none';
    }

    showError(message) {
        console.error('GitChanges Error:', message);
        this.showToast(message);
    }

    updateFileCounter(count) {
        const counter = document.getElementById('git-file-counter');
        if (counter) {
            counter.textContent = `${count} files`;
            counter.setAttribute('data-count', count);
        }
    }

    getAuthToken() {
        return window.mobileInterface?.authToken || '';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message) {
        if (window.mobileInterface) {
            window.mobileInterface.showToast(message);
        } else {
            console.log('Toast:', message);
        }
    }

    // Git Operations
    async stageFile(filePath) {
        const startTime = performance.now();
        
        // Add animation to file item
        this.animateFileOperation(filePath, 'staging');
        
        try {
            const response = await fetch('/api/git/stage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({ filePath })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast(result.message);
                await this.loadGitStatus(); // Refresh status
                
                // Track performance
                const duration = performance.now() - startTime;
                this.trackPerformance('stage-file', duration);
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('Error staging file:', error);
            this.showError('Failed to stage file');
        } finally {
            // Remove animation class after operation
            setTimeout(() => this.clearFileAnimation(filePath, 'staging'), 800);
        }
    }

    async unstageFile(filePath) {
        const startTime = performance.now();
        
        // Add animation to file item
        this.animateFileOperation(filePath, 'unstaging');
        
        try {
            const response = await fetch('/api/git/unstage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({ filePath })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast(result.message);
                await this.loadGitStatus(); // Refresh status
                
                // Track performance
                const duration = performance.now() - startTime;
                this.trackPerformance('unstage-file', duration);
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('Error unstaging file:', error);
            this.showError('Failed to unstage file');
        } finally {
            // Remove animation class after operation
            setTimeout(() => this.clearFileAnimation(filePath, 'unstaging'), 800);
        }
    }

    async discardFile(filePath) {
        const startTime = performance.now();
        
        // Add animation to file item
        this.animateFileOperation(filePath, 'discarding');
        
        try {
            const response = await fetch('/api/git/discard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({ filePath })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast(result.message);
                await this.loadGitStatus(); // Refresh status
                
                // Track performance
                const duration = performance.now() - startTime;
                this.trackPerformance('discard-file', duration);
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('Error discarding changes:', error);
            this.showError('Failed to discard changes');
        } finally {
            // Remove animation class after operation
            setTimeout(() => this.clearFileAnimation(filePath, 'discarding'), 600);
        }
    }

    async stageAllFiles() {
        try {
            const response = await fetch('/api/git/stage-all', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast(result.message);
                await this.loadGitStatus(); // Refresh status
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('Error staging all files:', error);
            this.showError('Failed to stage all files');
        }
    }

    async unstageAllFiles() {
        try {
            const response = await fetch('/api/git/unstage-all', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast(result.message);
                await this.loadGitStatus(); // Refresh status
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('Error unstaging all files:', error);
            this.showError('Failed to unstage all files');
        }
    }

    // Confirmation Modal Methods
    confirmAction(action, filePath = null) {
        this.pendingAction = { action, filePath };
        
        const modal = document.getElementById('git-confirm-modal');
        const title = document.getElementById('git-confirm-title');
        const icon = document.getElementById('git-confirm-icon');
        const message = document.getElementById('git-confirm-message');
        const details = document.getElementById('git-confirm-details');
        
        let config = this.getActionConfig(action, filePath);
        
        if (title) title.textContent = config.title;
        if (icon) icon.textContent = config.icon;
        if (message) message.textContent = config.message;
        if (details) details.textContent = config.details;
        
        modal.style.display = 'flex';
    }

    getActionConfig(action, filePath) {
        const configs = {
            'discard': {
                title: 'Discard Changes',
                icon: '⚠️',
                message: filePath ? `Discard changes in ${filePath}?` : 'Discard all changes?',
                details: 'This action cannot be undone. All changes will be permanently lost.'
            },
            'stage-all': {
                title: 'Stage All Files',
                icon: '📥',
                message: 'Stage all modified files?',
                details: 'This will prepare all changes for commit.'
            },
            'unstage-all': {
                title: 'Unstage All Files',
                icon: '📤',
                message: 'Unstage all staged files?',
                details: 'This will move all staged changes back to working directory.'
            }
        };
        
        return configs[action] || {
            title: 'Confirm Action',
            icon: '❓',
            message: 'Are you sure?',
            details: 'This action will be performed.'
        };
    }

    async executeAction() {
        if (!this.pendingAction) return;
        
        const { action, filePath } = this.pendingAction;
        
        this.closeConfirmModal();
        
        switch (action) {
            case 'discard':
                if (filePath) {
                    await this.discardFile(filePath);
                }
                break;
                
            case 'stage-all':
                await this.stageAllFiles();
                break;
                
            case 'unstage-all':
                await this.unstageAllFiles();
                break;
        }
        
        this.pendingAction = null;
    }

    closeConfirmModal() {
        const modal = document.getElementById('git-confirm-modal');
        modal.style.display = 'none';
        this.pendingAction = null;
    }

    // Context Expansion
    async expandContext(hunkIndex, direction, numLines) {
        if (!this.currentDiffFile) return;
        
        try {
            const compareMode = document.getElementById('diff-compare-mode')?.value || 'working';
            
            // Calculate the start line based on the hunk and direction
            const diffLines = document.getElementById('diff-lines');
            const hunkLine = diffLines.children[hunkIndex];
            
            if (!hunkLine) return;
            
            // Parse the hunk header to get line numbers
            const hunkText = hunkLine.textContent;
            const match = hunkText.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            
            if (!match) return;
            
            const oldLineStart = parseInt(match[1]);
            let startLine;
            
            if (direction === 'before') {
                startLine = Math.max(0, oldLineStart - numLines - 1);
            } else {
                // For after, we need to find the end of this hunk
                startLine = oldLineStart + 10; // Rough estimate, could be improved
            }
            
            const response = await fetch(`/api/git/expand-context/${encodeURIComponent(this.currentDiffFile)}?startLine=${startLine}&numLines=${numLines}&compare=${compareMode}`, {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            // Insert the expanded context lines
            this.insertExpandedContext(hunkIndex, direction, result.lines);
            
        } catch (error) {
            console.error('Error expanding context:', error);
            this.showError('Failed to expand context');
        }
    }

    insertExpandedContext(hunkIndex, direction, contextLines) {
        const diffLines = document.getElementById('diff-lines');
        const hunkLine = diffLines.children[hunkIndex];
        const expandControl = diffLines.children[hunkIndex + 1];
        
        if (!hunkLine || !expandControl) return;
        
        // Create elements for the new context lines
        const fragment = document.createDocumentFragment();
        
        contextLines.forEach(line => {
            const lineEl = this.createDiffLine(line);
            fragment.appendChild(lineEl);
        });
        
        // Insert the context lines in the right place
        if (direction === 'before') {
            diffLines.insertBefore(fragment, hunkLine);
        } else {
            // Find the next hunk or end of diff to insert after
            let insertPoint = expandControl.nextSibling;
            while (insertPoint && !insertPoint.classList.contains('diff-line--hunk')) {
                insertPoint = insertPoint.nextSibling;
            }
            
            if (insertPoint) {
                diffLines.insertBefore(fragment, insertPoint);
            } else {
                diffLines.appendChild(fragment);
            }
        }
        
        // Update the expand control to show fewer lines or remove it
        this.updateExpandControl(expandControl, direction, contextLines.length);
        
        this.showToast(`Expanded ${contextLines.length} context lines`);
    }

    updateExpandControl(expandControl, direction, expandedLines) {
        // Simple implementation: just remove the used expand button
        const buttons = expandControl.querySelectorAll('.expand-btn');
        buttons.forEach(btn => {
            if ((direction === 'before' && btn.textContent.includes('above')) ||
                (direction === 'after' && btn.textContent.includes('below'))) {
                btn.style.opacity = '0.5';
                btn.disabled = true;
                btn.textContent = btn.textContent.replace(/\d+ lines/, `${expandedLines} lines expanded`);
            }
        });
    }

    // Search and Filter Methods
    toggleSearch() {
        this.searchVisible = !this.searchVisible;
        const searchContainer = document.getElementById('git-search-container');
        const searchToggle = document.getElementById('git-search-toggle');
        
        if (this.searchVisible) {
            searchContainer.style.display = 'block';
            searchToggle.style.background = 'var(--primary-blue)';
            searchToggle.style.color = 'white';
            
            // Focus the search input
            const searchInput = document.getElementById('git-search-input');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 100);
            }
        } else {
            searchContainer.style.display = 'none';
            searchToggle.style.background = '';
            searchToggle.style.color = '';
            
            // Clear search when hiding
            this.clearSearch();
        }
    }

    handleSearch(query) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.currentSearch = query.toLowerCase().trim();
            this.searchMode = this.detectSearchMode(query);
            this.refreshFileDisplay();
            
            // Show/hide clear button
            const clearBtn = document.getElementById('git-search-clear');
            if (clearBtn) {
                clearBtn.style.display = this.currentSearch ? 'block' : 'none';
            }
            
            // If content search, perform async content search
            if (this.searchMode === 'content') {
                this.performContentSearch(query);
            }
        }, 300);
    }

    detectSearchMode(query) {
        // Check if query looks like regex (contains special regex characters)
        const regexPattern = /[.*+?^${}()|[\]\\]/;
        if (regexPattern.test(query) && query.length > 1) {
            try {
                new RegExp(query, 'i');
                return 'regex';
            } catch (e) {
                return 'text';
            }
        }
        
        // Check if query contains content search syntax (e.g., "content:function")
        if (query.includes('content:')) {
            return 'content';
        }
        
        return 'text';
    }

    async performContentSearch(query) {
        if (!query.includes('content:')) return;
        
        const searchTerm = query.replace('content:', '').trim();
        if (!searchTerm) return;
        
        try {
            const response = await fetch(`/api/git/search-content?q=${encodeURIComponent(searchTerm)}`, {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const results = await response.json();
                this.highlightContentMatches(results);
            }
        } catch (error) {
            console.error('Content search failed:', error);
        }
    }

    highlightContentMatches(results) {
        const gitFiles = document.getElementById('git-files');
        if (!gitFiles) return;
        
        const fileItems = gitFiles.querySelectorAll('.git-file-item');
        fileItems.forEach(item => {
            const filePath = item.querySelector('.git-file-path').textContent;
            const match = results.find(r => r.path === filePath);
            
            if (match) {
                item.classList.add('has-content-match');
                const matchInfo = document.createElement('div');
                matchInfo.className = 'content-match-info';
                matchInfo.textContent = `${match.matches} match${match.matches !== 1 ? 'es' : ''}`;
                item.querySelector('.git-file-info').appendChild(matchInfo);
            } else {
                item.classList.remove('has-content-match');
                const existing = item.querySelector('.content-match-info');
                if (existing) existing.remove();
            }
        });
    }

    clearSearch() {
        this.currentSearch = '';
        const searchInput = document.getElementById('git-search-input');
        const clearBtn = document.getElementById('git-search-clear');
        
        if (searchInput) searchInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        
        this.refreshFileDisplay();
    }

    setFilter(status) {
        this.currentFilter = status;
        
        // Update active filter button and ARIA states
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            const isActive = btn.getAttribute('data-status') === status;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive.toString());
        });
        
        this.refreshFileDisplay();
        this.announceToScreenReader(`Filter set to ${status}`);
    }

    filterFiles(files) {
        let filtered = [...files];
        
        // Apply search filter with different modes
        if (this.currentSearch) {
            filtered = filtered.filter(file => {
                if (this.searchMode === 'regex') {
                    try {
                        const regex = new RegExp(this.currentSearch, 'i');
                        return regex.test(file.path);
                    } catch (e) {
                        // Fallback to text search if regex is invalid
                        return file.path.toLowerCase().includes(this.currentSearch);
                    }
                } else if (this.searchMode === 'content') {
                    // Content search filtering will be handled by highlightContentMatches
                    return true;
                } else {
                    // Default text search
                    return file.path.toLowerCase().includes(this.currentSearch);
                }
            });
        }
        
        // Apply status filter
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(file => {
                switch (this.currentFilter) {
                    case 'modified':
                        return file.status === 'modified';
                    case 'added':
                        return file.status === 'added';
                    case 'deleted':
                        return file.status === 'deleted';
                    case 'staged':
                        return file.staged;
                    default:
                        return true;
                }
            });
        }
        
        return filtered;
    }

    refreshFileDisplay() {
        if (this.gitFiles.length > 0) {
            this.renderFileList(this.gitFiles, false);
        }
    }

    // Keyboard Shortcuts
    handleKeyboardShortcuts(e) {
        // Only handle shortcuts when git section is expanded and no modal is open
        if (!this.isExpanded || this.isDiffModalOpen() || this.isConfirmModalOpen()) {
            return;
        }

        // Don't interfere with typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        const key = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // Handle different keyboard shortcuts
        switch (key) {
            case 'r':
                if (ctrl) {
                    e.preventDefault();
                    this.loadGitStatus();
                    this.showToast('Git status refreshed');
                }
                break;

            case 'f':
                if (ctrl) {
                    e.preventDefault();
                    this.toggleSearch();
                }
                break;

            case '/':
                if (!ctrl) {
                    e.preventDefault();
                    this.toggleSearch();
                }
                break;

            case 'escape':
                if (this.searchVisible) {
                    e.preventDefault();
                    this.toggleSearch();
                }
                break;

            case 'a':
                if (ctrl && shift) {
                    e.preventDefault();
                    this.confirmAction('stage-all');
                }
                break;

            case 'u':
                if (ctrl && shift) {
                    e.preventDefault();
                    this.confirmAction('unstage-all');
                }
                break;

            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                if (ctrl) {
                    e.preventDefault();
                    const filters = ['all', 'modified', 'added', 'deleted', 'staged'];
                    const filterIndex = parseInt(key) - 1;
                    if (filterIndex < filters.length) {
                        this.setFilter(filters[filterIndex]);
                    }
                }
                break;

            case 'enter':
                // If a file is focused/highlighted, open its diff
                const focused = document.querySelector('.git-file-item:focus');
                if (focused) {
                    e.preventDefault();
                    const filePath = this.getFilePathFromElement(focused);
                    if (filePath) {
                        this.showFileDiff(filePath);
                    }
                }
                break;

            case 'arrowdown':
            case 'arrowup':
                // Navigate between files
                if (!shift && !ctrl) {
                    e.preventDefault();
                    this.navigateFiles(key === 'arrowdown' ? 1 : -1);
                }
                break;

            case 's':
                // Stage focused file
                if (ctrl) {
                    e.preventDefault();
                    const focused = document.querySelector('.git-file-item:focus');
                    if (focused) {
                        const filePath = this.getFilePathFromElement(focused);
                        if (filePath) {
                            this.stageFile(filePath);
                        }
                    }
                }
                break;

            case 'd':
                // Discard focused file (with confirmation)
                if (ctrl && shift) {
                    e.preventDefault();
                    const focused = document.querySelector('.git-file-item:focus');
                    if (focused) {
                        const filePath = this.getFilePathFromElement(focused);
                        if (filePath) {
                            this.confirmAction('discard', filePath);
                        }
                    }
                }
                break;
        }
    }

    isDiffModalOpen() {
        const modal = document.getElementById('diff-viewer-modal');
        return modal && modal.style.display === 'flex';
    }

    isConfirmModalOpen() {
        const modal = document.getElementById('git-confirm-modal');
        return modal && modal.style.display === 'flex';
    }

    getFilePathFromElement(element) {
        const pathElement = element.querySelector('.git-file-path');
        return pathElement ? pathElement.textContent : null;
    }

    navigateFiles(direction) {
        const fileItems = document.querySelectorAll('.git-file-item');
        if (fileItems.length === 0) return;

        let currentIndex = -1;
        const focused = document.querySelector('.git-file-item:focus');
        
        if (focused) {
            currentIndex = Array.from(fileItems).indexOf(focused);
        }

        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = fileItems.length - 1;
        if (newIndex >= fileItems.length) newIndex = 0;

        // Remove focus from current item
        if (focused) {
            focused.blur();
            focused.classList.remove('focused');
        }

        // Focus new item
        const newItem = fileItems[newIndex];
        newItem.focus();
        newItem.classList.add('focused');
        newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showKeyboardHelp() {
        const shortcuts = [
            'Ctrl+R - Refresh git status',
            'Ctrl+F or / - Toggle search',
            'Esc - Close search',
            'Ctrl+Shift+A - Stage all files',
            'Ctrl+Shift+U - Unstage all files',
            'Ctrl+1-5 - Filter by status',
            '↑/↓ - Navigate files',
            'Enter - View diff',
            'Ctrl+S - Stage file',
            'Ctrl+Shift+D - Discard file'
        ];
        
        const helpText = shortcuts.join('\n');
        this.showToast('Keyboard Shortcuts:\n' + helpText);
    }

    // Swipe Gestures for Mobile
    addSwipeGestures(element, file) {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let isSwipeActive = false;
        const swipeThreshold = 80; // Minimum distance for swipe
        const timeThreshold = 500; // Maximum time in ms
        
        // Create swipe indicator
        const swipeIndicator = document.createElement('div');
        swipeIndicator.className = 'swipe-indicator';
        element.appendChild(swipeIndicator);
        
        element.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
            isSwipeActive = true;
            
            // Prevent scrolling during potential swipe
            if (Math.abs(touch.clientX - startX) > 10) {
                e.preventDefault();
            }
        }, { passive: false });
        
        element.addEventListener('touchmove', (e) => {
            if (!isSwipeActive) return;
            
            const touch = e.touches[0];
            const diffX = touch.clientX - startX;
            const diffY = touch.clientY - startY;
            
            // If more vertical than horizontal movement, cancel swipe
            if (Math.abs(diffY) > Math.abs(diffX)) {
                isSwipeActive = false;
                this.resetSwipeIndicator(swipeIndicator);
                return;
            }
            
            // Show swipe feedback
            if (Math.abs(diffX) > 20) {
                e.preventDefault();
                this.updateSwipeIndicator(swipeIndicator, diffX, file);
            }
        }, { passive: false });
        
        element.addEventListener('touchend', (e) => {
            if (!isSwipeActive) return;
            
            const touch = e.changedTouches[0];
            const diffX = touch.clientX - startX;
            const diffY = touch.clientY - startY;
            const timeDiff = Date.now() - startTime;
            
            isSwipeActive = false;
            
            // Check if it's a valid swipe
            if (Math.abs(diffX) > swipeThreshold && 
                Math.abs(diffY) < 50 && 
                timeDiff < timeThreshold) {
                
                if (diffX > 0) {
                    // Swipe right - Stage file
                    this.handleSwipeAction('stage', file);
                } else {
                    // Swipe left - Discard/Delete file
                    this.handleSwipeAction('discard', file);
                }
            }
            
            this.resetSwipeIndicator(swipeIndicator);
        });
    }
    
    updateSwipeIndicator(indicator, diffX, file) {
        const progress = Math.min(Math.abs(diffX) / 80, 1);
        const direction = diffX > 0 ? 'right' : 'left';
        
        indicator.style.display = 'flex';
        indicator.style.opacity = progress;
        
        if (direction === 'right') {
            indicator.className = 'swipe-indicator swipe-indicator--stage';
            indicator.innerHTML = `<span class="swipe-icon">📥</span><span class="swipe-text">Stage</span>`;
            indicator.style.left = '0';
            indicator.style.right = 'auto';
        } else {
            indicator.className = 'swipe-indicator swipe-indicator--discard';
            indicator.innerHTML = `<span class="swipe-icon">🗑️</span><span class="swipe-text">Discard</span>`;
            indicator.style.right = '0';
            indicator.style.left = 'auto';
        }
    }
    
    resetSwipeIndicator(indicator) {
        indicator.style.display = 'none';
        indicator.style.opacity = '0';
    }
    
    handleSwipeAction(action, file) {
        // Add haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
        
        if (action === 'stage') {
            this.stageFile(file.path);
            this.showToast(`📥 Staged: ${file.path.split('/').pop()}`);
        } else if (action === 'discard') {
            this.confirmAction('discard', file.path);
        }
    }

    // Accessibility helpers
    announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'sr-only';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        // Remove after announcement
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }
    
    focusNextFileItem(currentItem) {
        const gitFiles = document.getElementById('git-files');
        if (!gitFiles) return;
        
        const fileItems = Array.from(gitFiles.querySelectorAll('.git-file-item'));
        const currentIndex = fileItems.indexOf(currentItem);
        const nextIndex = (currentIndex + 1) % fileItems.length;
        
        if (fileItems[nextIndex]) {
            fileItems[nextIndex].focus();
        }
    }
    
    focusPreviousFileItem(currentItem) {
        const gitFiles = document.getElementById('git-files');
        if (!gitFiles) return;
        
        const fileItems = Array.from(gitFiles.querySelectorAll('.git-file-item'));
        const currentIndex = fileItems.indexOf(currentItem);
        const prevIndex = currentIndex === 0 ? fileItems.length - 1 : currentIndex - 1;
        
        if (fileItems[prevIndex]) {
            fileItems[prevIndex].focus();
        }
    }

    // Animation helpers
    animateFileOperation(filePath, animationType) {
        const gitFiles = document.getElementById('git-files');
        if (!gitFiles) return;
        
        const fileItems = gitFiles.querySelectorAll('.git-file-item');
        fileItems.forEach(item => {
            const pathElement = item.querySelector('.git-file-path');
            if (pathElement && pathElement.textContent === filePath) {
                item.classList.add(animationType);
            }
        });
    }
    
    clearFileAnimation(filePath, animationType) {
        const gitFiles = document.getElementById('git-files');
        if (!gitFiles) return;
        
        const fileItems = gitFiles.querySelectorAll('.git-file-item');
        fileItems.forEach(item => {
            const pathElement = item.querySelector('.git-file-path');
            if (pathElement && pathElement.textContent === filePath) {
                item.classList.remove(animationType);
            }
        });
    }

    // Performance Monitoring
    trackPerformance(operation, duration) {
        if (!this.performanceMetrics) {
            this.performanceMetrics = {};
        }
        
        if (!this.performanceMetrics[operation]) {
            this.performanceMetrics[operation] = [];
        }
        
        this.performanceMetrics[operation].push(duration);
        
        // Keep only last 10 measurements
        if (this.performanceMetrics[operation].length > 10) {
            this.performanceMetrics[operation].shift();
        }
        
        // Log slow operations
        if (duration > 1000) {
            console.warn(`Slow git operation: ${operation} took ${duration}ms`);
        }
    }
    
    getPerformanceStats() {
        if (!this.performanceMetrics) return {};
        
        const stats = {};
        for (const [operation, times] of Object.entries(this.performanceMetrics)) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            const max = Math.max(...times);
            const min = Math.min(...times);
            
            stats[operation] = {
                average: Math.round(avg),
                max: Math.round(max),
                min: Math.round(min),
                count: times.length
            };
        }
        
        return stats;
    }

    togglePerformanceDashboard() {
        const dashboard = document.getElementById('performance-dashboard');
        if (!dashboard) return;
        
        if (dashboard.classList.contains('visible')) {
            dashboard.classList.remove('visible');
        } else {
            this.updatePerformanceDashboard();
            dashboard.classList.add('visible');
        }
    }

    updatePerformanceDashboard() {
        const metricsContainer = document.getElementById('performance-metrics');
        const performanceIndicator = document.getElementById('performance-indicator');
        const performanceStatus = document.getElementById('performance-status');
        
        if (!metricsContainer) return;
        
        const stats = this.getPerformanceStats();
        metricsContainer.innerHTML = '';
        
        if (Object.keys(stats).length === 0) {
            metricsContainer.innerHTML = '<div class="performance-metric"><div class="metric-name">No Data</div><div class="metric-value">--<span class="metric-unit">ms</span></div></div>';
            return;
        }
        
        // Calculate overall performance status
        let overallAvg = 0;
        let totalOperations = 0;
        
        for (const [operation, data] of Object.entries(stats)) {
            const metricEl = document.createElement('div');
            metricEl.className = 'performance-metric';
            
            const operationName = operation.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
            metricEl.innerHTML = `
                <div class="metric-name">${operationName}</div>
                <div class="metric-value">${data.average}<span class="metric-unit">ms</span></div>
            `;
            
            metricsContainer.appendChild(metricEl);
            
            overallAvg += data.average * data.count;
            totalOperations += data.count;
        }
        
        // Update overall status indicator
        if (totalOperations > 0) {
            overallAvg = overallAvg / totalOperations;
            
            if (performanceIndicator && performanceStatus) {
                performanceIndicator.className = 'performance-indicator';
                
                if (overallAvg < 500) {
                    performanceIndicator.classList.add('fast');
                    performanceStatus.textContent = 'Fast';
                } else if (overallAvg > 1500) {
                    performanceIndicator.classList.add('slow');
                    performanceStatus.textContent = 'Slow';
                } else {
                    performanceStatus.textContent = 'Normal';
                }
            }
        }
    }
}

// Initialize the mobile interface
const mobileInterface = new MobileInterface();

// Initialize file explorer
const fileExplorer = new FileExplorer();

// Initialize git changes
const gitChanges = new GitChanges();