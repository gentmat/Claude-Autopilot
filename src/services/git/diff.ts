import { spawn } from 'child_process';
import { GitDiffResult, GitDiffLine, GitCompareMode } from './types';
import { getWorkspaceRoot, resolveAndValidatePath, validateFileSize, sanitizeGitOutput, isGitRepository, GitSecurityError } from './security';

const GIT_TIMEOUT = 30000; // 30 seconds

export async function getFileDiff(filePath: string, compareMode: GitCompareMode = 'working'): Promise<GitDiffResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new GitSecurityError('No workspace available');
    }

    if (!isGitRepository(workspaceRoot)) {
        throw new GitSecurityError('Not a git repository');
    }

    const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
    
    if (!validateFileSize(resolvedPath)) {
        throw new GitSecurityError('File too large for diff operation');
    }

    const relativePath = filePath.replace(/^\/+/, '');
    
    let diffArgs: string[];
    switch (compareMode) {
        case 'staged':
            diffArgs = ['diff', '--cached', '--', relativePath];
            break;
        case 'head':
            diffArgs = ['diff', 'HEAD', '--', relativePath];
            break;
        case 'main':
            // Try main first, then master as fallback
            try {
                await executeGitCommand(['rev-parse', '--verify', 'main'], workspaceRoot);
                diffArgs = ['diff', 'main', '--', relativePath];
            } catch {
                diffArgs = ['diff', 'master', '--', relativePath];
            }
            break;
        case 'working':
        default:
            diffArgs = ['diff', '--', relativePath];
            break;
    }

    const diffOutput = await executeGitCommand([...diffArgs, '--no-color'], workspaceRoot);
    
    return parseDiffOutput(diffOutput, relativePath);
}

function parseDiffOutput(diffOutput: string, filePath: string): GitDiffResult {
    const lines = diffOutput.split('\n');
    const diffLines: GitDiffLine[] = [];
    
    let additions = 0;
    let deletions = 0;
    let isNew = false;
    let isDeleted = false;
    let isBinary = false;
    let oldPath: string | undefined;

    let oldLineNumber = 0;
    let newLineNumber = 0;
    let lastHunkHeader = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Parse diff headers
        if (line.startsWith('diff --git')) {
            const match = line.match(/diff --git a\/(.+) b\/(.+)/);
            if (match) {
                oldPath = match[1] !== match[2] ? match[1] : undefined;
            }
            diffLines.push({
                type: 'header',
                content: line
            });
            continue;
        }

        if (line.startsWith('new file mode')) {
            isNew = true;
            diffLines.push({
                type: 'header',
                content: line
            });
            continue;
        }

        if (line.startsWith('deleted file mode')) {
            isDeleted = true;
            diffLines.push({
                type: 'header',
                content: line
            });
            continue;
        }

        if (line.includes('Binary files')) {
            isBinary = true;
            diffLines.push({
                type: 'header',
                content: line
            });
            continue;
        }

        if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
            diffLines.push({
                type: 'header',
                content: line
            });
            continue;
        }

        // Parse hunk headers
        if (line.startsWith('@@')) {
            const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
            if (match) {
                oldLineNumber = parseInt(match[1]);
                newLineNumber = parseInt(match[3]);
                lastHunkHeader = line;
                
                // Check if this hunk can be expanded
                const oldLines = parseInt(match[2]) || 1;
                const newLines = parseInt(match[4]) || 1;
                const contextBefore = oldLineNumber > 1;
                const contextAfter = true; // We can always try to expand after
                
                diffLines.push({
                    type: 'hunk',
                    content: line,
                    hunkHeader: line,
                    expandable: contextBefore || contextAfter,
                    expandBefore: contextBefore ? Math.max(0, oldLineNumber - 1) : 0,
                    expandAfter: contextAfter ? 10 : 0 // Default 10 lines expansion
                });
            }
            continue;
        }

        // Parse diff content
        if (line.startsWith('+')) {
            additions++;
            diffLines.push({
                type: 'addition',
                newLineNumber: newLineNumber++,
                content: line.substring(1)
            });
        } else if (line.startsWith('-')) {
            deletions++;
            diffLines.push({
                type: 'deletion',
                oldLineNumber: oldLineNumber++,
                content: line.substring(1)
            });
        } else if (line.startsWith(' ') || line === '') {
            // Context line
            diffLines.push({
                type: 'context',
                oldLineNumber: oldLineNumber++,
                newLineNumber: newLineNumber++,
                content: line.startsWith(' ') ? line.substring(1) : line
            });
        }
    }

    return {
        filePath,
        oldPath,
        isNew,
        isDeleted,
        isBinary,
        additions,
        deletions,
        lines: diffLines
    };
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