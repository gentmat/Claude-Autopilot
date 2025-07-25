import { spawn } from 'child_process';
import { getWorkspaceRoot, resolveAndValidatePath, sanitizeGitOutput, isGitRepository, GitSecurityError } from './security';

const GIT_TIMEOUT = 30000; // 30 seconds

export interface GitOperationResult {
    success: boolean;
    message: string;
    error?: string;
}

export async function stageFile(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        await executeGitCommand(['add', '--', relativePath], workspaceRoot);
        
        return {
            success: true,
            message: `File staged: ${relativePath}`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to stage file',
            error: message
        };
    }
}

export async function unstageFile(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        await executeGitCommand(['reset', 'HEAD', '--', relativePath], workspaceRoot);
        
        return {
            success: true,
            message: `File unstaged: ${relativePath}`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to unstage file',
            error: message
        };
    }
}

export async function discardChanges(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        // Check if file exists in HEAD (committed version)
        try {
            await executeGitCommand(['cat-file', '-e', `HEAD:${relativePath}`], workspaceRoot);
            // File exists in HEAD, restore it
            await executeGitCommand(['checkout', 'HEAD', '--', relativePath], workspaceRoot);
        } catch {
            // File doesn't exist in HEAD, it's untracked - remove it
            const fs = await import('fs');
            const path = await import('path');
            const fullPath = path.resolve(workspaceRoot, relativePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }
        
        return {
            success: true,
            message: `Changes discarded: ${relativePath}`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to discard changes',
            error: message
        };
    }
}

export async function stageAllFiles(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        await executeGitCommand(['add', '-A'], workspaceRoot);
        
        return {
            success: true,
            message: 'All files staged'
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to stage all files',
            error: message
        };
    }
}

export async function unstageAllFiles(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        await executeGitCommand(['reset', 'HEAD', '.'], workspaceRoot);
        
        return {
            success: true,
            message: 'All files unstaged'
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to unstage all files',
            error: message
        };
    }
}

export async function discardAllChanges(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        // Discard all unstaged changes
        await executeGitCommand(['checkout', '--', '.'], workspaceRoot);
        
        // Clean untracked files
        await executeGitCommand(['clean', '-fd'], workspaceRoot);
        
        return {
            success: true,
            message: 'All changes discarded'
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to discard all changes',
            error: message
        };
    }
}

export async function stageFiles(filePaths: string[]): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    if (filePaths.length === 0) {
        return { success: false, message: 'No files specified' };
    }

    try {
        // Validate all paths first
        const relativePaths = filePaths.map(filePath => {
            resolveAndValidatePath(workspaceRoot, filePath); // Throws if invalid
            return filePath.replace(/^\/+/, '');
        });
        
        await executeGitCommand(['add', '--', ...relativePaths], workspaceRoot);
        
        return {
            success: true,
            message: `${filePaths.length} files staged`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to stage files',
            error: message
        };
    }
}

export async function unstageFiles(filePaths: string[]): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    if (filePaths.length === 0) {
        return { success: false, message: 'No files specified' };
    }

    try {
        // Validate all paths first
        const relativePaths = filePaths.map(filePath => {
            resolveAndValidatePath(workspaceRoot, filePath); // Throws if invalid
            return filePath.replace(/^\/+/, '');
        });
        
        await executeGitCommand(['reset', 'HEAD', '--', ...relativePaths], workspaceRoot);
        
        return {
            success: true,
            message: `${filePaths.length} files unstaged`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            message: 'Failed to unstage files',
            error: message
        };
    }
}

async function executeGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const process = spawn('git', args, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            process.kill();
            reject(new Error('Git command timeout'));
        }, GIT_TIMEOUT);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0) {
                resolve(sanitizeGitOutput(stdout));
            } else {
                reject(new Error(`Git command failed: ${sanitizeGitOutput(stderr)}`));
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Git command error: ${error.message}`));
        });
    });
}