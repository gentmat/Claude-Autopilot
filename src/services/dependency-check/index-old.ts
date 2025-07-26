import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getErrorMessage } from '../../utils/error-handler';
import { showErrorFromException, showInfo } from '../../utils/notifications';
import { DebugEmojis } from '../../core/constants/ui-strings';

export interface DependencyCheckResult {
    available: boolean;
    version?: string;
    path?: string;
    error?: string;
    installInstructions?: string;
}

export async function checkClaudeInstallation(): Promise<DependencyCheckResult> {
    return new Promise((resolve) => {
        const process = spawn('claude', ['--version'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            process.kill();
            resolve({
                available: false,
                error: 'Command timeout - Claude CLI may not be installed',
                installInstructions: getClaudeInstallInstructions()
            });
        }, 5000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0 && stdout.trim()) {
                resolve({
                    available: true,
                    version: stdout.trim(),
                    path: 'claude' // Could be enhanced to find actual path
                });
            } else {
                resolve({
                    available: false,
                    error: stderr.trim() || 'Claude CLI not found in PATH',
                    installInstructions: getClaudeInstallInstructions()
                });
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
                available: false,
                error: `Failed to check Claude installation: ${error.message}`,
                installInstructions: getClaudeInstallInstructions()
            });
        });
    });
}

export async function checkPythonInstallation(): Promise<DependencyCheckResult> {
    const platform = os.platform();
    
    // Platform-specific Python command preferences
    let pythonCommands: string[];
    
    switch (platform) {
        case 'win32': // Windows
            pythonCommands = ['python', 'python3', 'py'];
            break;
        case 'darwin': // macOS
            pythonCommands = ['python3', 'python'];
            break;
        case 'linux': // Linux
            pythonCommands = ['python3', 'python'];
            break;
        default:
            pythonCommands = ['python3', 'python', 'py'];
    }
    
    for (const cmd of pythonCommands) {
        const result = await checkCommand(cmd, ['--version']);
        if (result.available) {
            // Verify Python version is 3.8+
            const versionResult = await verifyPythonVersion(cmd);
            if (versionResult.valid) {
                return {
                    ...result,
                    version: versionResult.version
                };
            } else {
                return {
                    available: false,
                    error: `Python version too old: ${versionResult.version}. Need Python 3.8+`,
                    installInstructions: getPythonInstallInstructions()
                };
            }
        }
    }
    
    return {
        available: false,
        error: 'Python not found in PATH',
        installInstructions: getPythonInstallInstructions()
    };
}

async function verifyPythonVersion(pythonCommand: string): Promise<{valid: boolean; version: string}> {
    try {
        const result = await checkCommand(pythonCommand, ['-c', '\'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")\'']);
        
        if (result.available && result.version) {
            const version = result.version.trim();
            const [major, minor] = version.split('.').map(Number);
            
            // Require Python 3.8+
            const valid = major === 3 && minor >= 8;
            
            return { valid, version };
        }
        
        return { valid: false, version: 'unknown' };
    } catch (error) {
        return { valid: false, version: 'unknown' };
    }
}

export async function checkPtyWrapperFile(): Promise<DependencyCheckResult> {
    try {
        // Check multiple possible locations for the wrapper file
        const possiblePaths = [
            path.join(__dirname, '..', '..', 'claude/session/claude_pty_wrapper.py'), // Development location
        ];
        
        for (const wrapperPath of possiblePaths) {
            try {
                if (fs.existsSync(wrapperPath)) {
                    const stats = fs.statSync(wrapperPath);
                    if (stats.isFile()) {
                        // Test if file is readable
                        fs.accessSync(wrapperPath, fs.constants.R_OK);
                        return {
                            available: true,
                            path: wrapperPath
                        };
                    }
                }
            } catch (error) {
                // Try next path
                continue;
            }
        }
        
        return {
            available: false,
            error: 'Claude PTY wrapper file not found in any expected location',
            installInstructions: 'The extension may not be properly installed. Try reinstalling the extension.'
        };
    } catch (error) {
        return {
            available: false,
            error: `Failed to check PTY wrapper: ${error}`,
            installInstructions: 'Please check file permissions and try reinstalling the extension.'
        };
    }
}

async function checkCommand(command: string, args: string[]): Promise<DependencyCheckResult> {
    return new Promise((resolve) => {
        const process = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            process.kill();
            resolve({
                available: false,
                error: `Command timeout: ${command}`
            });
        }, 3000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0) {
                resolve({
                    available: true,
                    version: stdout.trim() || stderr.trim(),
                    path: command
                });
            } else {
                resolve({
                    available: false,
                    error: `Command failed: ${command}`
                });
            }
        });

        process.on('error', () => {
            clearTimeout(timeout);
            resolve({
                available: false,
                error: `Command not found: ${command}`
            });
        });
    });
}

export async function checkNgrokInstallation(): Promise<DependencyCheckResult> {
    return new Promise((resolve) => {
        const process = spawn('ngrok', ['version'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            process.kill();
            resolve({
                available: false,
                error: 'Command timeout - ngrok may not be installed',
                installInstructions: getNgrokInstallInstructions()
            });
        }, 5000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0 && (stdout.trim() || stderr.trim())) {
                const version = stdout.trim() || stderr.trim();
                resolve({
                    available: true,
                    version: version,
                    path: 'ngrok'
                });
            } else {
                resolve({
                    available: false,
                    error: 'ngrok command failed - ngrok may not be installed correctly',
                    installInstructions: getNgrokInstallInstructions()
                });
            }
        });

        process.on('error', (err) => {
            clearTimeout(timeout);
            resolve({
                available: false,
                error: `ngrok not found: ${err.message}`,
                installInstructions: getNgrokInstallInstructions()
            });
        });
    });
}

function getNgrokInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `To install ngrok on macOS:
1. Visit https://ngrok.com/download
2. Download the macOS version
3. Extract the binary to /usr/local/bin/
   OR
1. Install via Homebrew: brew install ngrok/ngrok/ngrok
2. Sign up at https://ngrok.com and get your auth token
3. Run: ngrok config add-authtoken <your-token>`;
        
        case 'win32': // Windows
            return `To install ngrok on Windows:
1. Visit https://ngrok.com/download
2. Download the Windows version
3. Extract to a folder and add to your PATH
   OR
1. Install via Chocolatey: choco install ngrok
2. Sign up at https://ngrok.com and get your auth token
3. Run: ngrok config add-authtoken <your-token>`;
        
        case 'linux': // Linux
            return `To install ngrok on Linux:
1. Visit https://ngrok.com/download
2. Download the Linux version for your architecture
3. Extract to /usr/local/bin/ or add to PATH
   OR
1. Install via package manager (varies by distribution)
2. Sign up at https://ngrok.com and get your auth token  
3. Run: ngrok config add-authtoken <your-token>`;
        
        default:
            return `To install ngrok:
1. Visit https://ngrok.com/download
2. Download the version for your platform
3. Extract and add to your system PATH
4. Sign up at https://ngrok.com and get your auth token
5. Run: ngrok config add-authtoken <your-token>`;
    }
}

function getClaudeInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `To install Claude Code on macOS:
1. Visit https://www.anthropic.com/claude-code
2. Follow the installation instructions for macOS
3. Restart VS Code after installation`;
        
        case 'win32': // Windows
            return `To install Claude Code on Windows:
1. Visit https://www.anthropic.com/claude-code
2. Download the Windows installer
3. Run the installer as administrator
4. Restart VS Code after installation
5. Make sure Claude Code is in your PATH`;
        
        case 'linux': // Linux
            return `To install Claude Code on Linux:
1. Visit https://www.anthropic.com/claude-code
2. Follow the installation instructions for Linux
3. You may need to download and install manually
4. Make sure Claude Code is in your PATH
5. Restart VS Code after installation`;
        
        default:
            return `To install Claude Code:
1. Visit https://www.anthropic.com/claude-code
2. Follow the installation instructions for your platform
3. Make sure Claude Code is in your PATH
4. Restart VS Code after installation`;
    }
}

function getPythonInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `To install Python on macOS:
1. Visit https://python.org/downloads
2. Download Python 3.8 or later
3. Or use brew: 'brew install python3'
4. Restart VS Code after installation`;
        
        case 'win32': // Windows
            return `To install Python on Windows:
1. Visit https://python.org/downloads
2. Download Python 3.8 or later
3. Make sure to check "Add Python to PATH" during installation
4. Restart VS Code after installation`;
        
        case 'linux': // Linux
            return `To install Python on Linux:
1. Use your package manager: 'sudo apt install python3' (Ubuntu/Debian)
2. Or 'sudo yum install python3' (RedHat/CentOS)
3. Or 'sudo pacman -S python' (Arch)
4. Restart VS Code after installation`;
        
        default:
            return `To install Python:
1. Visit https://python.org/downloads
2. Download Python 3.8 or later for your platform
3. Make sure Python is in your PATH
4. Restart VS Code after installation`;
    }
}

export async function runDependencyCheck(): Promise<{
    claude: DependencyCheckResult;
    python: DependencyCheckResult;
    wrapper: DependencyCheckResult;
    ngrok: DependencyCheckResult;
    allReady: boolean;
}> {
    const [claude, python, wrapper, ngrok] = await Promise.all([
        checkClaudeInstallation(),
        checkPythonInstallation(),
        checkPtyWrapperFile(),
        checkNgrokInstallation()
    ]);

    const allReady = claude.available && python.available && wrapper.available && ngrok.available;

    return { claude, python, wrapper, ngrok, allReady };
}

export function showDependencyStatus(results: Awaited<ReturnType<typeof runDependencyCheck>>): void {
    const { claude, python, wrapper, ngrok, allReady } = results;
    
    if (allReady) {
        vscode.window.showInformationMessage(
            `${DebugEmojis.SUCCESS} All dependencies ready! Claude: ${claude.version}, Python: ${python.version}, ngrok: ${ngrok.version}`
        );
        return;
    }

    // Show issues
    const issues: string[] = [];
    
    if (!claude.available) {
        issues.push(`${DebugEmojis.ERROR} Claude Code: ${claude.error}`);
    }
    
    if (!python.available) {
        issues.push(`${DebugEmojis.ERROR} Python: ${python.error}`);
    }
    
    if (!wrapper.available) {
        issues.push(`${DebugEmojis.ERROR} PTY Wrapper: ${wrapper.error}`);
    }

    const message = `Dependencies missing:\n${issues.join('\n')}`;
    
    vscode.window.showErrorMessage(
        'Claude Autopilot: Missing Dependencies',
        'Show Instructions',
        'Retry Check'
    ).then(selection => {
        if (selection === 'Show Instructions') {
            showInstallationInstructions(results);
        } else if (selection === 'Retry Check') {
            // Re-run check
            runDependencyCheck().then(showDependencyStatus, error => {
                showErrorFromException(error, 'Dependency check failed');
            });
        }
    });
}

function showInstallationInstructions(results: Awaited<ReturnType<typeof runDependencyCheck>>): void {
    const { claude, python, wrapper, ngrok } = results;
    
    let instructions = 'Claude Autopilot Installation Requirements:\n\n';
    
    if (!claude.available) {
        instructions += `🔴 Claude Code Missing:\n${claude.installInstructions}\n\n`;
    } else {
        instructions += `${DebugEmojis.SUCCESS} Claude Code: ${claude.version}\n\n`;
    }
    
    if (!python.available) {
        instructions += `🔴 Python Missing:\n${python.installInstructions}\n\n`;
    } else {
        instructions += `${DebugEmojis.SUCCESS} Python: ${python.version}\n\n`;
    }
    
    if (!wrapper.available) {
        instructions += `🔴 PTY Wrapper Missing:\n${wrapper.installInstructions}\n\n`;
    } else {
        instructions += `${DebugEmojis.SUCCESS} PTY Wrapper: Ready\n\n`;
    }
    
    if (!ngrok.available) {
        instructions += `🔴 ngrok Missing:\n${ngrok.installInstructions}\n\n`;
    } else {
        instructions += `${DebugEmojis.SUCCESS} ngrok: ${ngrok.version}\n\n`;
    }
    
    instructions += 'After installing dependencies, restart VS Code and try again.';
    
    // Create and show a new document with instructions
    vscode.workspace.openTextDocument({
        content: instructions,
        language: 'markdown'
    }).then(doc => {
        vscode.window.showTextDocument(doc);
    }, error => {
        showErrorFromException(error, 'Failed to show installation instructions');
        // Fallback to information message
        showInfo(instructions);
    });
}