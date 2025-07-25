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
        
        // Load file tree immediately since section is always expanded
        this.loadFileTree();
        
        console.log('🚀 FileExplorer: Initialized and loading file tree');
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
        this.isExpanded = true; // Always expanded since toggle is removed
        this.gitFiles = [];
        this.currentDiffFile = null;
        this.refreshInterval = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadGitStatus();
        
        // Auto-refresh every 30 seconds (always check for file count)
        this.refreshInterval = setInterval(() => {
            this.loadGitStatus();
        }, 30000);
    }

    setupEventListeners() {
        // Toggle git section
        const gitToggle = document.getElementById('git-toggle');
        if (gitToggle) {
            gitToggle.addEventListener('click', () => this.toggleSection());
        }

        // Toggle versioned files subsection
        const versionedToggle = document.getElementById('versioned-toggle');
        if (versionedToggle) {
            versionedToggle.addEventListener('click', () => this.toggleSubsection('versioned'));
        }

        // Toggle unversioned files subsection
        const unversionedToggle = document.getElementById('unversioned-toggle');
        if (unversionedToggle) {
            unversionedToggle.addEventListener('click', () => this.toggleSubsection('unversioned'));
        }

        // Refresh git status
        const refreshGit = document.getElementById('refresh-git');
        if (refreshGit) {
            refreshGit.addEventListener('click', () => this.loadGitStatus());
        }

        // Diff viewer modal
        const closeDiff = document.getElementById('close-diff');
        if (closeDiff) {
            closeDiff.addEventListener('click', () => this.closeDiffViewer());
        }

        // Toggle diff mode
        const toggleDiffMode = document.getElementById('toggle-diff-mode');
        if (toggleDiffMode) {
            toggleDiffMode.addEventListener('click', () => this.toggleDiffMode());
        }

        // Modal click outside to close
        const diffModal = document.getElementById('diff-viewer-modal');
        if (diffModal) {
            diffModal.addEventListener('click', (e) => {
                if (e.target === diffModal) {
                    this.closeDiffViewer();
                }
            });
        }
    }

    async toggleSection() {
        this.isExpanded = !this.isExpanded;
        const content = document.getElementById('git-content');
        const toggle = document.getElementById('git-toggle');
        const icon = toggle.querySelector('.toggle-icon');
        
        if (this.isExpanded) {
            content.style.display = 'block';
            icon.textContent = '▼';
            toggle.setAttribute('data-expanded', 'true');
            await this.loadGitStatus();
        } else {
            content.style.display = 'none';
            icon.textContent = '▶';
            toggle.setAttribute('data-expanded', 'false');
        }
    }

    toggleSubsection(section) {
        const toggle = document.getElementById(`${section}-toggle`);
        const content = document.getElementById(`${section}-content`);
        const icon = toggle.querySelector('.toggle-icon');
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        
        if (isExpanded) {
            content.style.display = 'none';
            icon.textContent = '▶';
            toggle.setAttribute('data-expanded', 'false');
        } else {
            content.style.display = 'block';
            icon.textContent = '▼';
            toggle.setAttribute('data-expanded', 'true');
        }
    }

    async loadGitStatus() {
        // Always update file counter, but only show loading/render when expanded
        if (this.isExpanded) {
            this.showLoading();
        }
        
        try {
            const response = await fetch('/api/git/status', {
                headers: {
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                    'x-session-token': this.getSessionToken()
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const status = await response.json();
            this.renderGitStatus(status);
            
        } catch (error) {
            console.error('Error loading git status:', error);
            if (this.isExpanded) {
                this.showError('Failed to load git status');
            }
        } finally {
            if (this.isExpanded) {
                this.hideLoading();
            }
        }
    }

    renderGitStatus(status) {
        this.gitFiles = status.files;
        
        // Categorize files into versioned and unversioned
        const versionedFiles = status.files.filter(file => file.status !== 'untracked');
        const unversionedFiles = status.files.filter(file => file.status === 'untracked');
        
        // Always update file counters
        this.updateFileCounters(versionedFiles.length, unversionedFiles.length, status.files.length);
        
        // Only render file lists when expanded
        if (this.isExpanded) {
            this.renderFileLists(versionedFiles, unversionedFiles, status.isClean);
        }
    }

    renderFileLists(versionedFiles, unversionedFiles, isClean) {
        const versionedSection = document.getElementById('versioned-section');
        const unversionedSection = document.getElementById('unversioned-section');
        const versionedFilesContainer = document.getElementById('versioned-files');
        const unversionedFilesContainer = document.getElementById('unversioned-files');
        const gitClean = document.getElementById('git-clean');
        
        if (isClean || (versionedFiles.length === 0 && unversionedFiles.length === 0)) {
            versionedSection.style.display = 'none';
            unversionedSection.style.display = 'none';
            gitClean.style.display = 'flex';
            return;
        }
        
        gitClean.style.display = 'none';
        
        // Show/hide sections based on content
        if (versionedFiles.length > 0) {
            versionedSection.style.display = 'block';
            versionedFilesContainer.innerHTML = versionedFiles.map(file => this.createFileItem(file)).join('');
        } else {
            versionedSection.style.display = 'none';
        }
        
        if (unversionedFiles.length > 0) {
            unversionedSection.style.display = 'block';
            unversionedFilesContainer.innerHTML = unversionedFiles.map(file => this.createFileItem(file)).join('');
        } else {
            unversionedSection.style.display = 'none';
        }
        
        // Add event listeners to file items in both sections
        this.attachFileEventListeners();
    }

    createFileItem(file) {
        const statusIcon = this.getStatusIcon(file.status);
        const statusClass = file.status.toLowerCase();
        const additions = file.additions || 0;
        const deletions = file.deletions || 0;
        
        return `
            <div class="git-file-item ${statusClass}" data-path="${file.path}" data-status="${file.status}">
                <div class="file-info">
                    <div class="file-status">
                        <span class="status-icon" title="${file.status}">${statusIcon}</span>
                    </div>
                    <div class="file-details">
                        <div class="file-path" title="${file.path}">${file.path}</div>
                        <div class="file-stats">
                            ${additions > 0 ? `<span class="additions">+${additions}</span>` : ''}
                            ${deletions > 0 ? `<span class="deletions">-${deletions}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getStatusIcon(status) {
        const icons = {
            'modified': '📝',
            'added': '➕',
            'deleted': '🗑️',
            'renamed': '↔️',
            'copied': '📋',
            'untracked': '❓'
        };
        return icons[status] || '📄';
    }

    attachFileEventListeners() {
        const fileItems = document.querySelectorAll('.git-file-item');
        
        fileItems.forEach(item => {
            // Click on file item to view diff
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.file-actions')) {
                    const filePath = item.getAttribute('data-path');
                    this.viewDiff(filePath);
                }
            });
            
            // Action buttons
            const actionButtons = item.querySelectorAll('.action-btn');
            actionButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute('data-action');
                    const filePath = item.getAttribute('data-path');
                    if (action === 'diff') {
                        this.viewDiff(filePath);
                    }
                });
            });
        });
    }

    async viewDiff(filePath) {
        this.currentDiffFile = filePath;
        this.showDiffViewer();
        await this.loadFileDiff(filePath);
    }

    showDiffViewer() {
        const modal = document.getElementById('diff-viewer-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    closeDiffViewer() {
        const modal = document.getElementById('diff-viewer-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentDiffFile = null;
    }

    toggleDiffMode() {
        const toggleBtn = document.getElementById('toggle-diff-mode');
        const diffModeSpan = document.getElementById('diff-mode');
        const diffContent = document.getElementById('diff-content');
        
        if (!toggleBtn || !diffModeSpan || !diffContent) return;

        // Check current mode
        const currentMode = diffModeSpan.textContent;
        
        if (currentMode === 'Inline View') {
            // Switch to Final File View
            diffModeSpan.textContent = 'Final File';
            toggleBtn.textContent = '📋';
            toggleBtn.title = 'Show diff view';
            diffContent.classList.add('raw-view');
            diffContent.classList.remove('inline-diff');
        } else {
            // Switch to Inline View
            diffModeSpan.textContent = 'Inline View';
            toggleBtn.textContent = '📄';
            toggleBtn.title = 'Show final file';
            diffContent.classList.add('inline-diff');
            diffContent.classList.remove('raw-view');
        }
        
        // Reload the current file in the new mode
        if (this.currentDiffFile) {
            this.loadFileDiff(this.currentDiffFile);
        }
    }

    async loadFileDiff(filePath) {
        const diffLoading = document.getElementById('diff-loading');
        const diffContent = document.getElementById('diff-content');
        const diffError = document.getElementById('diff-error');
        const diffFileName = document.getElementById('diff-file-name');
        const diffFilePath = document.getElementById('diff-file-path');
        
        // Show loading
        if (diffLoading) diffLoading.style.display = 'flex';
        if (diffContent) diffContent.style.display = 'none';
        if (diffError) diffError.style.display = 'none';
        
        // Update file name and path
        if (diffFileName) diffFileName.textContent = filePath.split('/').pop();
        if (diffFilePath) diffFilePath.textContent = filePath;
        
        // Check if we're in raw view mode
        const diffModeSpan = document.getElementById('diff-mode');
        const isRawView = diffModeSpan && diffModeSpan.textContent === 'Final File';
        
        try {
            if (isRawView) {
                // Fetch the final file content
                const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`, {
                    headers: {
                        'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                        'x-session-token': this.getSessionToken()
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const fileContent = await response.text();
                this.renderFinalFile(fileContent);
            } else {
                // Fetch the diff
                const response = await fetch(`/api/git/file-diff?path=${encodeURIComponent(filePath)}&compare=working`, {
                    headers: {
                        'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                        'x-session-token': this.getSessionToken()
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const diff = await response.json();
                this.renderDiff(diff);
            }
            
        } catch (error) {
            console.error('Error loading file diff:', error);
            if (diffError) {
                diffError.style.display = 'block';
                diffError.querySelector('.error-text').textContent = 'Failed to load changes';
            }
        } finally {
            if (diffLoading) diffLoading.style.display = 'none';
        }
    }

    renderDiff(diff) {
        const diffContent = document.getElementById('diff-content');
        const diffEditor = document.getElementById('diff-editor');
        const diffAdditions = document.getElementById('diff-additions');
        const diffDeletions = document.getElementById('diff-deletions');
        
        if (diffContent) diffContent.style.display = 'block';
        
        // Update stats
        if (diffAdditions) diffAdditions.textContent = `+${diff.additions}`;
        if (diffDeletions) diffDeletions.textContent = `-${diff.deletions}`;
        
        if (diff.isBinary) {
            if (diffEditor) {
                diffEditor.innerHTML = '<div class="binary-notice">📁 Binary file - cannot show changes</div>';
            }
            return;
        }
        
        if (diff.isNew) {
            // For new files, show the entire content as additions
            this.renderInlineNewFile(diff);
            return;
        }
        
        if (diff.isDeleted) {
            if (diffEditor) {
                diffEditor.innerHTML = '<div class="deleted-file-notice">🗑️ Deleted file</div>';
            }
            return;
        }
        
        // Render inline diff view
        this.renderInlineDiff(diff);
    }

    renderFinalFile(fileContent) {
        const diffContent = document.getElementById('diff-content');
        const diffEditor = document.getElementById('diff-editor');
        const diffAdditions = document.getElementById('diff-additions');
        const diffDeletions = document.getElementById('diff-deletions');
        
        if (diffContent) diffContent.style.display = 'block';
        
        // Hide stats for final file view
        if (diffAdditions) diffAdditions.textContent = '';
        if (diffDeletions) diffDeletions.textContent = '';
        
        if (!diffEditor) return;
        
        // Display exactly like file explorer - pre > code structure
        const escapedContent = this.escapeHtml(fileContent);
        diffEditor.innerHTML = `<pre><code class="language-text">${escapedContent}</code></pre>`;
    }

    createDiffLine(line) {
        const typeClass = line.type;
        const lineNumbers = line.oldLineNumber && line.newLineNumber ? 
            `<span class="line-numbers"><span class="old-line">${line.oldLineNumber || ''}</span><span class="new-line">${line.newLineNumber || ''}</span></span>` :
            '';
        
        const content = this.escapeHtml(line.content);
        
        return `
            <div class="diff-line ${typeClass}">
                ${lineNumbers}
                <span class="line-content">${content}</span>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateFileCounters(versionedCount, unversionedCount, totalCount) {
        // Update main counter
        const mainCounter = document.getElementById('git-file-counter');
        if (mainCounter) {
            mainCounter.textContent = `${totalCount} file${totalCount !== 1 ? 's' : ''}`;
            mainCounter.setAttribute('data-count', totalCount);
        }
        
        // Update section counters
        const versionedCounter = document.getElementById('versioned-counter');
        if (versionedCounter) {
            versionedCounter.textContent = versionedCount;
        }
        
        const unversionedCounter = document.getElementById('unversioned-counter');
        if (unversionedCounter) {
            unversionedCounter.textContent = unversionedCount;
        }
    }

    getSessionToken() {
        return document.cookie
            .split('; ')
            .find(row => row.startsWith('sessionToken='))
            ?.split('=')[1] || '';
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

    renderInlineDiff(diff) {
        const diffEditor = document.getElementById('diff-editor');
        if (!diffEditor) return;
        
        let html = '';
        
        for (const line of diff.lines) {
            if (line.type === 'header') {
                continue; // Skip file headers
            }
            
            if (line.type === 'hunk') {
                // Show hunk headers to separate diff sections
                html += `
                    <div class="diff-line hunk-header">
                        <div class="line-numbers">
                            <span class="old-line-num">...</span>
                            <span class="new-line-num">...</span>
                        </div>
                        <div class="line-change-indicator"></div>
                        <div class="line-content">${this.escapeHtml(line.content)}</div>
                    </div>
                `;
                continue;
            }
            
            const lineClass = this.getInlineLineClass(line.type);
            const lineSymbol = this.getLineSymbol(line.type);
            
            // Use the actual line numbers from the diff data
            const oldLineNum = line.oldLineNumber || (line.type === 'addition' ? '' : '');
            const newLineNum = line.newLineNumber || (line.type === 'deletion' ? '' : '');
            
            html += `
                <div class="diff-line ${lineClass}">
                    <div class="line-numbers">
                        <span class="old-line-num">${oldLineNum}</span>
                        <span class="new-line-num">${newLineNum}</span>
                    </div>
                    <div class="line-change-indicator">${lineSymbol}</div>
                    <div class="line-content">${this.escapeHtml(line.content)}</div>
                </div>
            `;
        }
        
        diffEditor.innerHTML = html;
    }
    
    renderInlineNewFile(diff) {
        const diffEditor = document.getElementById('diff-editor');
        if (!diffEditor) return;
        
        let html = '';
        let lineNumber = 1;
        
        for (const line of diff.lines) {
            if (line.type === 'header') continue;
            
            html += `
                <div class="diff-line addition">
                    <div class="line-numbers">
                        <span class="old-line-num"></span>
                        <span class="new-line-num">${lineNumber}</span>
                    </div>
                    <div class="line-change-indicator">+</div>
                    <div class="line-content">${this.escapeHtml(line.content)}</div>
                </div>
            `;
            lineNumber++;
        }
        
        diffEditor.innerHTML = html;
    }
    
    getInlineLineClass(lineType) {
        switch (lineType) {
            case 'addition': return 'addition';
            case 'deletion': return 'deletion';
            case 'context': return 'context';
            default: return '';
        }
    }
    
    getLineSymbol(lineType) {
        switch (lineType) {
            case 'addition': return '+';
            case 'deletion': return '-';
            case 'context': return ' ';
            default: return '';
        }
    }

    showError(message) {
        console.error('Git error:', message);
        // Simple error display - could be enhanced with toast notifications
    }
}
// Initialize the mobile interface
const mobileInterface = new MobileInterface();

// Initialize file explorer
const fileExplorer = new FileExplorer();

// Initialize git changes
const gitChanges = new GitChanges();