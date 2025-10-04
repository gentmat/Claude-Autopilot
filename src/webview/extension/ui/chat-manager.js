// Chat management functions for real-time messaging
import { sendMessage } from '../communication/vscode-api.js';

let chatHistoryData = [];

export function sendChatMessage() {
    try {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message) {
            return;
        }

        // Send message immediately to backend
        sendMessage('sendChatMessage', { text: message });

        // Clear input
        input.value = '';
        
        // Add user message to chat UI immediately
        addMessageToChat('user', message);
        
    } catch (error) {
        console.error('Error sending chat message:', error);
        addMessageToChat('system', `Error: Failed to send message - ${error.message}`);
    }
}

export function clearChatHistory() {
    try {
        sendMessage('clearChatHistory', {});
        chatHistoryData = [];
        renderChatHistory();
    } catch (error) {
        console.error('Error clearing chat history:', error);
    }
}

export function handleChatHistoryUpdate(chatHistory) {
    chatHistoryData = chatHistory;
    renderChatHistory();
}

function renderChatHistory() {
    const container = document.getElementById('chatContainer');
    
    if (!chatHistoryData || chatHistoryData.length === 0) {
        container.innerHTML = `
            <div class="chat-welcome">
                <div class="pulse-dot"></div>
                <span>Ready to chat with Claude...</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    chatHistoryData.forEach(message => {
        const messageEl = createChatMessageElement(message);
        container.appendChild(messageEl);
    });
    
    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function addMessageToChat(role, content) {
    const message = {
        id: `temp_${Date.now()}`,
        role: role,
        content: content,
        timestamp: new Date().toISOString()
    };
    
    chatHistoryData.push(message);
    
    const container = document.getElementById('chatContainer');
    
    // Remove welcome message if exists
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageEl = createChatMessageElement(message);
    container.appendChild(messageEl);
    
    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function createChatMessageElement(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message chat-message--${message.role}`;
    
    const roleIcon = message.role === 'user' ? '👤' : message.role === 'assistant' ? '🤖' : 'ℹ️';
    const roleName = message.role.charAt(0).toUpperCase() + message.role.slice(1);
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    messageEl.innerHTML = `
        <div class="message-header">
            <span class="message-role">
                <span class="role-icon">${roleIcon}</span>
                ${roleName}
            </span>
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="message-content">${escapeHtml(message.content)}</div>
    `;
    
    return messageEl;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for global access
window.sendChatMessage = sendChatMessage;
window.clearChatHistory = clearChatHistory;
