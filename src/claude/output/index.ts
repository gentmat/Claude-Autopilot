import { claudePanel, claudeOutputBuffer, claudeCurrentScreen, claudeOutputTimer, claudeAutoClearTimer, lastClaudeOutputTime, setClaudeOutputBuffer, setClaudeCurrentScreen, setClaudeOutputTimer, setClaudeAutoClearTimer, setLastClaudeOutputTime, chatHistory } from '../../core/state';
import { CLAUDE_OUTPUT_THROTTLE_MS, CLAUDE_OUTPUT_AUTO_CLEAR_MS, CLAUDE_OUTPUT_MAX_BUFFER_SIZE, ANSI_CLEAR_SCREEN_PATTERNS } from '../../core/constants';
import { debugLog, formatTerminalOutput, sendToWebviewTerminal } from '../../utils/logging';
import { getMobileServer } from '../../services/mobile/index';
import { updateWebviewContent } from '../../ui/webview';
import { generateMessageId } from '../../utils/id-generator';

// Debouncing for repeated debug messages
let lastClearScreenLogTime = 0;
let clearScreenLogCount = 0;
const CLEAR_SCREEN_LOG_DEBOUNCE_MS = 1000; // Only log once per second

export function sendClaudeOutput(output: string): void {
    setClaudeOutputBuffer(claudeOutputBuffer + output);
    
    if (claudeOutputBuffer.length > CLAUDE_OUTPUT_MAX_BUFFER_SIZE) {
        debugLog(`📦 Buffer too large (${claudeOutputBuffer.length} chars), truncating...`);
        setClaudeOutputBuffer(claudeOutputBuffer.substring(claudeOutputBuffer.length - (CLAUDE_OUTPUT_MAX_BUFFER_SIZE * 0.75)));
    }
    
    let foundClearScreen = false;
    let lastClearScreenIndex = -1;
    
    for (const pattern of ANSI_CLEAR_SCREEN_PATTERNS) {
        const index = claudeOutputBuffer.lastIndexOf(pattern);
        if (index > lastClearScreenIndex) {
            lastClearScreenIndex = index;
            foundClearScreen = true;
        }
    }
    
    if (foundClearScreen) {
        // Debounce clear screen debug messages to prevent spam
        const now = Date.now();
        if (now - lastClearScreenLogTime >= CLEAR_SCREEN_LOG_DEBOUNCE_MS) {
            if (clearScreenLogCount > 0) {
                debugLog(`🖥️  Clear screen detected - reset screen buffer (${clearScreenLogCount + 1} times in last second)`);
            } else {
                debugLog(`🖥️  Clear screen detected - reset screen buffer`);
            }
            lastClearScreenLogTime = now;
            clearScreenLogCount = 0;
        } else {
            clearScreenLogCount++;
        }
        
        const newScreen = claudeOutputBuffer.substring(lastClearScreenIndex);
        setClaudeCurrentScreen(newScreen);
        setClaudeOutputBuffer(claudeCurrentScreen);
    } else {
        setClaudeCurrentScreen(claudeOutputBuffer);
    }
    
    const now = Date.now();
    const timeSinceLastOutput = now - lastClaudeOutputTime;
    
    if (timeSinceLastOutput >= CLAUDE_OUTPUT_THROTTLE_MS) {
        flushClaudeOutput();
    } else {
        if (!claudeOutputTimer) {
            const delay = CLAUDE_OUTPUT_THROTTLE_MS - timeSinceLastOutput;
            setClaudeOutputTimer(setTimeout(() => {
                flushClaudeOutput();
            }, delay));
        }
    }
    
    if (!claudeAutoClearTimer) {
        setClaudeAutoClearTimer(setTimeout(() => {
            clearClaudeOutput();
        }, CLAUDE_OUTPUT_AUTO_CLEAR_MS));
    }
}

export function flushClaudeOutput(): void {
    if (claudeCurrentScreen.length === 0) {
        return;
    }
    
    const output = claudeCurrentScreen;
    setLastClaudeOutputTime(Date.now());
    
    if (claudeOutputTimer) {
        clearTimeout(claudeOutputTimer);
        setClaudeOutputTimer(null);
    }
    
    debugLog(`📤 Sending Claude current screen (${output.length} chars)`);
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'claudeOutput',
                output: output
            });
        } catch (error) {
            debugLog(`❌ Failed to send Claude output to webview: ${error}`);
        }
    }
    
    const formattedOutput = formatTerminalOutput(output, 'claude');
    sendToWebviewTerminal(formattedOutput);
    
    // Attempt to derive assistant reply for chat UI when ready prompt is visible
    tryAppendAssistantFromScreen(output);
    
    // Notify mobile clients if mobile server is running
    try {
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyOutputUpdate();
        }
    } catch (error) {
        debugLog(`⚠️ Failed to notify mobile server of output update: ${error}`);
    }
}

export function clearClaudeOutput(): void {
    debugLog(`🧹 Auto-clearing Claude output buffer (${claudeCurrentScreen.length} chars)`);
    
    setClaudeOutputBuffer('');
    setClaudeCurrentScreen('');
    
    if (claudeOutputTimer) {
        clearTimeout(claudeOutputTimer);
    }
    if (claudeAutoClearTimer) {
        clearTimeout(claudeAutoClearTimer);
        setClaudeAutoClearTimer(null);
    }
}

// --- Chat assistant extraction from current screen ---
let lastAssistantSnapshot = '';

function tryAppendAssistantFromScreen(screen: string): void {
    // Only append when the last chat entry is a user message awaiting a reply
    const last = chatHistory[chatHistory.length - 1];
    if (!last || last.role !== 'user') return;

    // Detect ready prompt indicating completion/stability
    const readyPatterns: (RegExp | string)[] = [
        /\? for shortcuts/,
        /\u001b\[2m\u001b\[38;5;244m│\u001b\[39m\u001b\[22m\s>/,
        />\s*$/,
    ];
    const isReady = readyPatterns.some(p =>
        typeof p === 'string' ? screen.includes(p as string) : (p as RegExp).test(screen) || (p as RegExp).test(JSON.stringify(screen))
    );
    if (!isReady) return;

    // Use current screen as single source, trim to content after last clear-screen
    let content = claudeCurrentScreen;
    let lastIdx = -1;
    for (const pat of ANSI_CLEAR_SCREEN_PATTERNS) {
        const idx = content.lastIndexOf(pat);
        if (idx > lastIdx) lastIdx = idx;
    }
    if (lastIdx >= 0) {
        content = content.substring(lastIdx);
    }

    const plain = stripAnsi(content).trim();
    if (!plain) return;

    // Deduplicate if screen hasn't changed materially
    if (plain === lastAssistantSnapshot) return;

    // Filter out pure prompt-only output
    const promptOnly = /^(?:\? for shortcuts|>\s*)$/m.test(plain) || plain.replace(/[\s\n]+/g, '') === '>';
    if (promptOnly) return;

    // Append as assistant message
    chatHistory.push({
        id: generateMessageId(),
        role: 'assistant',
        content: plain,
        timestamp: new Date().toISOString()
    });
    lastAssistantSnapshot = plain;
    updateWebviewContent();
}

function stripAnsi(text: string): string {
    return text
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\r/g, '')
        .trim();
}