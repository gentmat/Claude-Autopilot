import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
    claudeProcess, sessionReady, currentMessage, processingQueue,
    setClaudeProcess, setSessionReady, setCurrentMessage, setProcessingQueue
} from '../../core/state';
import { debugLog, formatTerminalOutput, sendToWebviewTerminal } from '../../utils/logging';
import { getErrorMessage } from '../../utils/error-handler';
import { showInfo, showError, showErrorFromException, Messages } from '../../utils/notifications';
import { DebugEmojis, formatDebugMessage } from '../../core/constants/ui-strings';
import { updateWebviewContent, updateSessionState } from '../../ui/webview';
import { sendClaudeOutput } from '../../claude/output';
import { handleUsageLimit, isCurrentUsageLimit } from '../../services/usage';
import { startHealthCheck, stopHealthCheck } from '../../services/health';
import { startSleepPrevention, stopSleepPrevention } from '../../services/sleep';
import { runDependencyCheck, showDependencyStatus } from '../../services/dependency-check';

export async function startClaudeSession(skipPermissions: boolean = true): Promise<void> {
    debugLog('=== STARTING CLAUDE SESSION ===');
    
    try {
        if (claudeProcess) {
            showInfo(Messages.SESSION_ALREADY_RUNNING);
            debugLog('Claude session already running - aborting');
            return;
        }

        // Check dependencies before starting
        debugLog(formatDebugMessage(DebugEmojis.SEARCH, 'Checking dependencies...'));
        let dependencyResults;
        try {
            dependencyResults = await runDependencyCheck();
        } catch (error) {
            debugLog(formatDebugMessage(DebugEmojis.ERROR, `Failed to check dependencies: ${error}`));
            showErrorFromException(error, 'Failed to check dependencies');
            return;
        }
        
        // Check if all critical dependencies are ready
        const allReady = dependencyResults.claude.available && 
                        dependencyResults.python.available && 
                        dependencyResults.wrapper.available;
        
        if (!allReady) {
            debugLog('❌ Dependencies not satisfied, showing status');
            showDependencyStatus(dependencyResults);
            return;
        }
        
        debugLog('✅ All dependencies satisfied, proceeding with session start');

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath || process.cwd();
        
        debugLog(`Working directory: ${cwd}`);
        debugLog('Spawning Claude process...');
        
        // Use the detected Python path
        const pythonPath = dependencyResults.python.path || 'python3';
        
        // Verify wrapper file exists
        const wrapperPath = dependencyResults.wrapper.path;
        if (!wrapperPath) {
            const errorMsg = 'Claude PTY wrapper not found. Please reinstall the extension.';
            showError(errorMsg);
            debugLog('❌ PTY wrapper file not found');
            throw new Error(errorMsg);
        }
        
        // Verify wrapper file is readable
        try {
            if (!fs.existsSync(wrapperPath)) {
                throw new Error('Wrapper file does not exist');
            }
            fs.accessSync(wrapperPath, fs.constants.R_OK);
        } catch (error) {
            const errorMsg = `Cannot access PTY wrapper: ${getErrorMessage(error)}`;
            showError(errorMsg);
            debugLog(formatDebugMessage(DebugEmojis.ERROR, `Cannot access wrapper file: ${error}`));
            throw new Error(errorMsg);
        }
    
        const args = [wrapperPath];
        if (skipPermissions) {
            args.push('--skip-permissions');
        }
        
        debugLog(`Using Python: ${pythonPath}`);
        debugLog(`Using wrapper: ${wrapperPath}`);
        
        let spawnedProcess;
        try {
            spawnedProcess = spawn(pythonPath, args, {
                cwd: cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { 
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLUMNS: '120',
                    LINES: '30'
                }
            });
        } catch (error) {
            const errorMsg = `Failed to spawn Claude process: ${getErrorMessage(error)}`;
            showError(errorMsg);
            debugLog(formatDebugMessage(DebugEmojis.ERROR, `Process spawn error: ${error}`));
            throw new Error(errorMsg);
        }

        if (!spawnedProcess || !spawnedProcess.pid) {
            const errorMsg = 'Failed to start Claude process - no process ID';
            showError(errorMsg);
            debugLog('❌ Failed to start Claude process - no PID');
            throw new Error(errorMsg);
        }

    setClaudeProcess(spawnedProcess);
    debugLog(`✓ Claude process started successfully`);
    debugLog(`Process PID: ${spawnedProcess.pid}`);
    
    spawnedProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        
        sendClaudeOutput(output);
        
        if (output.includes('Claude usage limit reached') || output.includes('usage limit reached')) {
            debugLog('⚠️ POTENTIAL USAGE LIMIT DETECTED');
            debugLog(`📋 Usage limit output: ${output}`);
            if (currentMessage && isCurrentUsageLimit(output)) {
                debugLog('✅ Confirmed: This is a current usage limit');
                handleUsageLimit(output, currentMessage);
            } else {
                debugLog('⚠️ Skipped: Usage limit is old or not within 6-hour window');
            }
            return;
        }
        
        const claudeAuthErrors = [
            'Claude CLI authentication failed',
            'Please authenticate with Claude'
        ];
        const isAuthError = claudeAuthErrors.some(authError => output.includes(authError));
        
        if (isAuthError) {
            debugLog('🔐 AUTHENTICATION ERROR detected');
            setSessionReady(false);
            if (currentMessage) {
                currentMessage.status = 'error';
                currentMessage.error = 'Claude CLI authentication failed';
                updateWebviewContent();
            }
            vscode.window.showErrorMessage('Claude CLI authentication failed');
            return;
        }
        
        const permissionPrompts = [
            'Do you want to make this edit to',
            'Do you want to create',
            'Do you want to delete',
            'Do you want to read',
            'Would you like to',
            'Proceed with',
            'Continue?'
        ];
        
        const hasPermissionPrompt = permissionPrompts.some(prompt => output.includes(prompt));
        
        if (hasPermissionPrompt && !sessionReady) {
            debugLog('🔐 Permission prompt detected during startup - session ready for user interaction');
            setSessionReady(true);
            startHealthCheck();
            startSleepPrevention();
            updateSessionState();
            vscode.window.showInformationMessage('Claude is asking for permission. Use the Claude output area to navigate and select your choice.');
        } else if (output.includes('? for shortcuts') && !sessionReady) {
            debugLog('✅ Claude ready prompt detected during startup');
            setSessionReady(true);
            startHealthCheck();
            startSleepPrevention();
            updateSessionState();
            vscode.window.showInformationMessage('Claude session started and ready! You can now process the message queue.');
        }
    });

    spawnedProcess.stderr?.on('data', (data: Buffer) => {
        const error = data.toString();
        debugLog(`📥 STDERR: ${error}`);
        
        const formattedError = formatTerminalOutput(error, 'error');
        sendToWebviewTerminal(formattedError);
    });

    spawnedProcess.on('close', (code: number | null) => {
        debugLog(`🔚 PROCESS CLOSED with code: ${code}`);
        setSessionReady(false);
        stopHealthCheck();
        stopSleepPrevention();
        
        // Output flushing handled elsewhere
        
        const wasProcessing = processingQueue;
        setProcessingQueue(false);
        
        const closeMessage = formatTerminalOutput(`Claude process closed with code: ${code}`, 'info');
        sendToWebviewTerminal(closeMessage);
        
        if (currentMessage && currentMessage.status === 'processing') {
            debugLog(`❌ Current message #${currentMessage.id} marked as error due to process closure`);
            currentMessage.status = 'error';
            currentMessage.error = `Claude process closed unexpectedly (code: ${code})`;
            setCurrentMessage(null);
        }
        
        setClaudeProcess(null);
        
        updateWebviewContent();
        updateSessionState();
        
        if (wasProcessing) {
            vscode.window.showWarningMessage('Claude process closed unexpectedly while processing. You can restart the session.');
        } else {
            vscode.window.showInformationMessage('Claude session ended');
        }
        debugLog('=== CLAUDE SESSION ENDED ===');
    });

    spawnedProcess.on('error', (error: Error) => {
        debugLog(`💥 PROCESS ERROR: ${error.message}`);
        
        setSessionReady(false);
        stopHealthCheck();
        stopSleepPrevention();
        
        // Output flushing handled elsewhere
        
        const wasProcessing = processingQueue;
        setProcessingQueue(false);
        
        const errorMessage = formatTerminalOutput(`Claude process error: ${error.message}`, 'error');
        sendToWebviewTerminal(errorMessage);
        
        if (currentMessage && currentMessage.status === 'processing') {
            debugLog(`❌ Current message #${currentMessage.id} marked as error due to process error`);
            currentMessage.status = 'error';
            currentMessage.error = `Claude process error: ${error.message}`;
            setCurrentMessage(null);
        }
        
        setClaudeProcess(null);
        
        updateWebviewContent();
        updateSessionState();
        
        if (wasProcessing) {
            vscode.window.showErrorMessage(`Claude process error while processing: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(`Claude process error: ${error.message}`);
        }
        debugLog('=== CLAUDE SESSION ENDED WITH ERROR ===');
    });

    } catch (error) {
        // Global catch block for any unexpected errors during session startup
        const errorMsg = `Failed to start Claude session: ${getErrorMessage(error)}`;
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Claude session startup failed: ${error}`));
        vscode.window.showErrorMessage(errorMsg);
        
        // Clean up any partial state
        if (claudeProcess) {
            try {
                claudeProcess.kill();
            } catch (killError) {
                debugLog(`❌ Error killing process during cleanup: ${killError}`);
            }
            setClaudeProcess(null);
        }
        
        setSessionReady(false);
        stopHealthCheck();
        stopSleepPrevention();
        updateSessionState();
        
        throw error; // Re-throw to allow callers to handle
    }
}

export function resetClaudeSession(): void {
    if (claudeProcess) {
        claudeProcess.kill();
        setClaudeProcess(null);
        setSessionReady(false);
    }
    
    stopSleepPrevention();
    setCurrentMessage(null);
    setProcessingQueue(false);
    
    updateWebviewContent();
    updateSessionState();
    vscode.window.showInformationMessage('Claude session reset. You can now start a new session.');
}

export function handleClaudeKeypress(key: string): void {
    if (!claudeProcess || !claudeProcess.stdin) {
        debugLog(`❌ Cannot send keypress: Claude process not available`);
        vscode.window.showWarningMessage('Claude process not available for keypress input');
        return;
    }

    debugLog(`⌨️  Sending keypress: ${key}`);
    
    try {
        switch (key) {
            case 'up':
                claudeProcess.stdin.write('\x1b[A');
                break;
            case 'down':
                claudeProcess.stdin.write('\x1b[B');
                break;
            case 'left':
                claudeProcess.stdin.write('\x1b[D');
                break;
            case 'right':
                claudeProcess.stdin.write('\x1b[C');
                break;
            case 'enter':
                claudeProcess.stdin.write('\r');
                break;
            case 'escape':
                claudeProcess.stdin.write('\x1b');
                break;
            default:
                debugLog(`❌ Unknown key: ${key}`);
                vscode.window.showWarningMessage(`Unknown key command: ${key}`);
                return;
        }
    } catch (error) {
        const errorMsg = `Failed to send keypress '${key}': ${getErrorMessage(error)}`;
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Keypress error: ${error}`));
        vscode.window.showErrorMessage(errorMsg);
    }
}