/**
 * Individual dependency checker functions
 */
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DependencyCheckResult } from './types';

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
                    error: stderr || 'Claude CLI not found or returned empty version',
                    installInstructions: getClaudeInstallInstructions()
                });
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
                available: false,
                error: `Failed to run claude command: ${error.message}`,
                installInstructions: getClaudeInstallInstructions()
            });
        });
    });
}

export async function checkPythonInstallation(): Promise<DependencyCheckResult> {
    // Try different Python commands in order of preference
    const pythonCommands = ['python3', 'python'];
    
    for (const pythonCommand of pythonCommands) {
        try {
            const result = await checkCommand(pythonCommand, ['--version']);
            if (result.available) {
                // Verify minimum Python version (3.7+)
                const versionCheck = await verifyPythonVersion(pythonCommand);
                if (versionCheck.valid) {
                    return {
                        available: true,
                        version: versionCheck.version,
                        path: pythonCommand
                    };
                } else {
                    return {
                        available: false,
                        error: `Python version ${versionCheck.version} is too old. Minimum required: 3.7`,
                        installInstructions: getPythonInstallInstructions()
                    };
                }
            }
        } catch (error) {
            // Continue to next python command
            continue;
        }
    }
    
    return {
        available: false,
        error: 'Python not found. Tried: python3, python',
        installInstructions: getPythonInstallInstructions()
    };
}

export async function checkPtyWrapperAvailability(): Promise<DependencyCheckResult> {
    try {
        const wrapperPath = path.join(__dirname, '../../claude/session/claude_pty_wrapper.py');
        
        // Check if the wrapper file exists
        if (!fs.existsSync(wrapperPath)) {
            return {
                available: false,
                error: `PTY wrapper not found at expected path: ${wrapperPath}`,
                installInstructions: 'The PTY wrapper should be included with the extension. Try reinstalling the extension.'
            };
        }
        
        // Check if the file is readable
        try {
            fs.accessSync(wrapperPath, fs.constants.R_OK);
            return {
                available: true,
                version: 'Ready',
                path: wrapperPath
            };
        } catch (accessError) {
            return {
                available: false,
                error: `PTY wrapper exists but is not readable: ${accessError}`,
                installInstructions: 'Check file permissions on the PTY wrapper file.'
            };
        }
    } catch (error) {
        return {
            available: false,
            error: `Error checking PTY wrapper: ${error}`,
            installInstructions: 'Try reinstalling the extension to restore the PTY wrapper.'
        };
    }
}

export async function checkNgrokInstallation(): Promise<DependencyCheckResult> {
    const result = await checkCommand('ngrok', ['version']);
    if (!result.available) {
        result.installInstructions = getNgrokInstallInstructions();
    }
    return result;
}

async function verifyPythonVersion(pythonCommand: string): Promise<{valid: boolean; version: string}> {
    return new Promise((resolve) => {
        const process = spawn(pythonCommand, ['--version'], {
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
            resolve({ valid: false, version: 'unknown' });
        }, 5000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0) {
                // Parse version from output like "Python 3.9.7"
                const versionOutput = stdout || stderr;
                const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/);
                
                if (versionMatch) {
                    const version = versionMatch[1];
                    const [major, minor] = version.split('.').map(Number);
                    
                    // Check if version is 3.7 or higher
                    const isValid = major > 3 || (major === 3 && minor >= 7);
                    resolve({ valid: isValid, version });
                } else {
                    resolve({ valid: false, version: versionOutput.trim() });
                }
            } else {
                resolve({ valid: false, version: 'unknown' });
            }
        });

        process.on('error', () => {
            clearTimeout(timeout);
            resolve({ valid: false, version: 'unknown' });
        });
    });
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
        }, 10000);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0) {
                const output = stdout || stderr;
                const version = output.trim();
                
                resolve({
                    available: true,
                    version,
                    path: command
                });
            } else {
                resolve({
                    available: false,
                    error: stderr || `Command failed: ${command}`
                });
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
                available: false,
                error: `Failed to run ${command}: ${error.message}`
            });
        });
    });
}

function getClaudeInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `Claude CLI Installation (macOS):
1. Install via Homebrew: brew install claude-cli
2. Or download from: https://claude.ai/docs/cli
3. After installation, restart VS Code
4. Verify installation: claude --version`;
            
        case 'win32': // Windows
            return `Claude CLI Installation (Windows):
1. Download from: https://claude.ai/docs/cli
2. Add to system PATH
3. Restart VS Code
4. Verify installation: claude --version`;
            
        case 'linux': // Linux
            return `Claude CLI Installation (Linux):
1. Download from: https://claude.ai/docs/cli
2. Make executable: chmod +x claude
3. Move to PATH: sudo mv claude /usr/local/bin/
4. Restart VS Code
5. Verify installation: claude --version`;
            
        default:
            return `Claude CLI Installation:
1. Visit: https://claude.ai/docs/cli
2. Download for your platform
3. Follow platform-specific installation instructions
4. Restart VS Code
5. Verify installation: claude --version`;
    }
}

function getPythonInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `Python Installation (macOS):
1. Install via Homebrew: brew install python3
2. Or download from: https://python.org/downloads
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        case 'win32': // Windows  
            return `Python Installation (Windows):
1. Download from: https://python.org/downloads
2. During installation, check "Add Python to PATH"
3. Restart VS Code
4. Verify installation: python --version`;
            
        case 'linux': // Linux
            return `Python Installation (Linux):
1. Ubuntu/Debian: sudo apt update && sudo apt install python3
2. CentOS/RHEL: sudo yum install python3
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        default:
            return `Python Installation:
1. Visit: https://python.org/downloads
2. Download Python 3.7 or higher
3. Follow platform-specific installation instructions
4. Restart VS Code
5. Verify installation: python3 --version`;
    }
}

function getNgrokInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `ngrok Installation (macOS):
1. Install via Homebrew: brew install ngrok/ngrok/ngrok
2. Or download from: https://ngrok.com/download
3. Create account at: https://dashboard.ngrok.com/signup
4. Set auth token: ngrok authtoken <your-token>
5. Restart VS Code
6. Verify installation: ngrok version`;
            
        case 'win32': // Windows
            return `ngrok Installation (Windows):
1. Download from: https://ngrok.com/download
2. Extract to desired location
3. Add to system PATH
4. Create account at: https://dashboard.ngrok.com/signup
5. Set auth token: ngrok authtoken <your-token>
6. Restart VS Code
7. Verify installation: ngrok version`;
            
        case 'linux': // Linux
            return `ngrok Installation (Linux):
1. Download from: https://ngrok.com/download
2. Extract: tar -xzf ngrok-v3-stable-linux-amd64.tgz
3. Move to PATH: sudo mv ngrok /usr/local/bin/
4. Create account at: https://dashboard.ngrok.com/signup
5. Set auth token: ngrok authtoken <your-token>
6. Restart VS Code
7. Verify installation: ngrok version`;
            
        default:
            return `ngrok Installation:
1. Visit: https://ngrok.com/download
2. Download for your platform
3. Follow platform-specific installation instructions
4. Create account at: https://dashboard.ngrok.com/signup
5. Set auth token: ngrok authtoken <your-token>
6. Restart VS Code
7. Verify installation: ngrok version`;
    }
}