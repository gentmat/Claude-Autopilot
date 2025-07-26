/**
 * File explorer functionality for the mobile server
 */
import { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { MAX_FILE_SIZE } from '../../core/constants/timeouts';

export interface FileTreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileTreeNode[];
    size?: number;
    modified?: string;
}

export class FileExplorer {
    private getWorkspaceRoot(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
    }

    private validateAndResolvePath(workspaceRoot: string, requestPath: string): string | null {
        try {
            // Normalize and resolve the path
            const resolvedPath = path.resolve(workspaceRoot, requestPath || '.');
            
            // Ensure the resolved path is within the workspace
            if (!resolvedPath.startsWith(workspaceRoot)) {
                console.warn('Path traversal attempt detected:', requestPath);
                return null;
            }
            
            return resolvedPath;
        } catch (error) {
            console.error('Error resolving path:', error);
            return null;
        }
    }

    buildFileTree(dirPath: string, maxDepth: number = 3, currentDepth: number = 0): FileTreeNode[] {
        try {
            if (currentDepth >= maxDepth) {
                return [];
            }

            const items = fs.readdirSync(dirPath);
            const result: FileTreeNode[] = [];

            for (const item of items) {
                // Skip hidden files and common ignore patterns
                if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'build') {
                    continue;
                }

                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
                const relativePath = path.relative(this.getWorkspaceRoot() || '', itemPath);

                const node: FileTreeNode = {
                    name: item,
                    path: relativePath,
                    isDirectory: stats.isDirectory(),
                    size: stats.isDirectory() ? undefined : stats.size,
                    modified: stats.mtime.toISOString()
                };

                if (stats.isDirectory()) {
                    node.children = this.buildFileTree(itemPath, maxDepth, currentDepth + 1);
                }

                result.push(node);
            }

            // Sort: directories first, then files, both alphabetically
            result.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            return result;
        } catch (error) {
            console.error('Error building file tree:', error);
            return [];
        }
    }

    handleFileExplorer(req: Request, res: Response) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return res.status(400).json({ error: 'No workspace folder open' });
        }

        try {
            const requestPath = req.query.path as string || '';
            const resolvedPath = this.validateAndResolvePath(workspaceRoot, requestPath);
            
            if (!resolvedPath) {
                return res.status(400).json({ error: 'Invalid path' });
            }

            const stats = fs.statSync(resolvedPath);
            
            if (stats.isDirectory()) {
                const fileTree = this.buildFileTree(resolvedPath, 2);
                res.json({ 
                    type: 'directory',
                    path: requestPath || '',
                    contents: fileTree 
                });
            } else {
                // Return file metadata
                res.json({
                    type: 'file',
                    path: requestPath,
                    name: path.basename(resolvedPath),
                    size: stats.size,
                    modified: stats.mtime.toISOString()
                });
            }
        } catch (error) {
            console.error('Error in file explorer:', error);
            res.status(500).json({ error: 'Failed to access path' });
        }
    }

    handleFileContent(req: Request, res: Response) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return res.status(400).json({ error: 'No workspace folder open' });
        }

        try {
            const filePath = req.query.path as string;
            if (!filePath) {
                return res.status(400).json({ error: 'File path is required' });
            }

            const resolvedPath = this.validateAndResolvePath(workspaceRoot, filePath);
            if (!resolvedPath) {
                return res.status(400).json({ error: 'Invalid file path' });
            }

            const stats = fs.statSync(resolvedPath);
            if (stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is a directory, not a file' });
            }

            // Check file size (limit to 1MB for safety)
            if (stats.size > MAX_FILE_SIZE) {
                return res.status(400).json({ error: 'File too large to display' });
            }

            const content = fs.readFileSync(resolvedPath, 'utf8');
            const ext = path.extname(resolvedPath).toLowerCase();
            
            res.json({
                content,
                path: filePath,
                name: path.basename(resolvedPath),
                size: stats.size,
                modified: stats.mtime.toISOString(),
                extension: ext,
                language: this.getLanguageFromExtension(ext)
            });
        } catch (error) {
            console.error('Error reading file:', error);
            if (error instanceof Error && error.message.includes('ENOENT')) {
                res.status(404).json({ error: 'File not found' });
            } else {
                res.status(500).json({ error: 'Failed to read file' });
            }
        }
    }

    private getLanguageFromExtension(ext: string): string {
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.py': 'python',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.md': 'markdown',
            '.txt': 'text',
            '.yml': 'yaml',
            '.yaml': 'yaml',
            '.xml': 'xml',
            '.sh': 'bash',
            '.sql': 'sql',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby'
        };
        return languageMap[ext] || 'text';
    }
}