# Mobile File Explorer & Preview Specification

## Overview
Add file explorer and preview functionality to the existing mobile interface for Claude Autopilot, allowing users to browse workspace files and preview their contents on mobile devices.

## Core Requirements

### 1. File Explorer Integration
- **Location**: Add as new collapsible section in existing mobile interface
- **Position**: Between Queue Section and Output Section
- **State**: Collapsed by default to preserve existing UX

### 2. File Tree Navigation
- **Root**: Start from workspace root directory
- **Hierarchy**: Expandable folder tree structure
- **Icons**: File type icons (folder, .js, .ts, .md, .json, etc.)
- **Sorting**: Folders first, then files alphabetically
- **Filtering**: Hide common ignore patterns (.git, node_modules, .DS_Store)

### 3. File Preview
- **Trigger**: Tap on file name to open preview modal
- **Content**: Syntax-highlighted code/text content
- **Limitations**: Files up to 100KB, first 1000 lines max
- **Formats**: Support text files, code files, markdown, JSON, logs

## Technical Implementation

### Backend API Endpoints

#### GET `/api/files/tree`
```json
{
  "path": "/optional/subfolder",
  "maxDepth": 3
}
```

Response:
```json
{
  "items": [
    {
      "name": "src",
      "type": "directory",
      "path": "/workspace/src",
      "children": [...],
      "expanded": false
    },
    {
      "name": "package.json",
      "type": "file",
      "path": "/workspace/package.json",
      "size": 1245,
      "modified": "2023-07-24T10:30:00Z",
      "extension": "json"
    }
  ]
}
```

#### GET `/api/files/content`
```json
{
  "path": "/workspace/src/extension.ts"
}
```

Response:
```json
{
  "content": "file content here...",
  "language": "typescript",
  "size": 5420,
  "lines": 180,
  "truncated": false
}
```

#### GET `/api/files/search`
```json
{
  "query": "function",
  "path": "/workspace/src",
  "extensions": [".ts", ".js"]
}
```

Response:
```json
{
  "results": [
    {
      "file": "/workspace/src/extension.ts",
      "matches": [
        {
          "line": 45,
          "content": "function activate(context) {",
          "column": 0
        }
      ]
    }
  ]
}
```

### Frontend Components

#### 1. File Explorer Section
```html
<section class="file-explorer-section">
    <header class="section-header">
        <h2 class="section-title">
            File Explorer
            <span class="file-counter" id="file-counter">0 files</span>
        </h2>
        <div class="explorer-controls">
            <button class="control-btn" id="refresh-files">🔄</button>
            <button class="control-btn" id="search-files">🔍</button>
        </div>
        <button class="section-toggle" id="explorer-toggle" data-expanded="false">
            <span class="toggle-icon">▶</span>
        </button>
    </header>
    
    <div class="section-content" id="explorer-content" style="display: none;">
        <div class="file-tree" id="file-tree">
            <!-- File tree items populated by JavaScript -->
        </div>
    </div>
</section>
```

#### 2. File Preview Modal
```html
<div class="modal file-preview-modal" id="file-preview-modal">
    <div class="modal-content">
        <div class="modal-header">
            <h3 id="preview-file-name">Loading...</h3>
            <div class="preview-controls">
                <button class="control-btn" id="copy-file-path">📋</button>
                <button class="modal-close" id="close-preview">&times;</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="file-info">
                <span class="file-size" id="preview-file-size">0 KB</span>
                <span class="file-modified" id="preview-file-modified">Modified: --</span>
            </div>
            <div class="preview-content">
                <pre><code id="preview-code-content" class="language-javascript"></code></pre>
            </div>
        </div>
    </div>
</div>
```

#### 3. File Search Modal
```html
<div class="modal file-search-modal" id="file-search-modal">
    <div class="modal-content">
        <div class="modal-header">
            <h3>Search Files</h3>
            <button class="modal-close" id="close-search">&times;</button>
        </div>
        <div class="modal-body">
            <input type="text" id="search-input" placeholder="Search in files...">
            <div class="search-filters">
                <select id="search-extensions">
                    <option value="">All files</option>
                    <option value=".ts,.js">TypeScript/JavaScript</option>
                    <option value=".md">Markdown</option>
                    <option value=".json">JSON</option>
                </select>
            </div>
            <div class="search-results" id="search-results">
                <!-- Search results populated by JavaScript -->
            </div>
        </div>
    </div>
</div>
```

### Mobile-Optimized CSS

#### File Tree Styling
```css
.file-tree {
    max-height: 400px;
    overflow-y: auto;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 14px;
}

.file-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    cursor: pointer;
    user-select: none;
}

.file-item:hover {
    background: rgba(255,255,255,0.05);
}

.file-indent {
    width: 20px;
    flex-shrink: 0;
}

.file-icon {
    width: 16px;
    height: 16px;
    margin-right: 8px;
    flex-shrink: 0;
}

.file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-meta {
    font-size: 11px;
    opacity: 0.6;
    margin-left: 8px;
}
```

#### Preview Modal Styling
```css
.file-preview-modal .modal-content {
    width: 95vw;
    height: 85vh;
    max-width: none;
}

.preview-content {
    height: calc(100% - 80px);
    overflow: auto;
    background: #1e1e1e;
    border-radius: 4px;
}

.preview-content pre {
    margin: 0;
    padding: 16px;
    font-size: 12px;
    line-height: 1.4;
    font-family: 'SF Mono', Monaco, monospace;
}

.file-info {
    display: flex;
    gap: 16px;
    padding: 8px 0;
    font-size: 12px;
    opacity: 0.7;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    margin-bottom: 12px;
}
```

### JavaScript Implementation

#### File Tree Management
```javascript
class FileExplorer {
    constructor() {
        this.expandedFolders = new Set();
        this.fileTree = null;
        this.initializeEventListeners();
    }

    async loadFileTree(path = '') {
        try {
            const response = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`, {
                headers: { 'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}` }
            });
            const data = await response.json();
            this.renderFileTree(data.items);
        } catch (error) {
            console.error('Failed to load file tree:', error);
        }
    }

    renderFileTree(items, container = null, level = 0) {
        if (!container) {
            container = document.getElementById('file-tree');
            container.innerHTML = '';
        }

        items.forEach(item => {
            const fileItem = this.createFileItem(item, level);
            container.appendChild(fileItem);

            if (item.type === 'directory' && item.children && this.expandedFolders.has(item.path)) {
                this.renderFileTree(item.children, container, level + 1);
            }
        });
    }

    createFileItem(item, level) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <div class="file-indent" style="width: ${level * 20}px;"></div>
            <div class="file-icon">${this.getFileIcon(item)}</div>
            <div class="file-name">${item.name}</div>
            <div class="file-meta">${item.type === 'file' ? this.formatFileSize(item.size) : ''}</div>
        `;

        div.addEventListener('click', () => {
            if (item.type === 'directory') {
                this.toggleFolder(item.path);
            } else {
                this.previewFile(item.path);
            }
        });

        return div;
    }

    getFileIcon(item) {
        if (item.type === 'directory') {
            return this.expandedFolders.has(item.path) ? '📂' : '📁';
        }
        
        const icons = {
            '.js': '🟨', '.ts': '🔷', '.json': '📄', '.md': '📝',
            '.css': '🎨', '.html': '🌐', '.py': '🐍', '.java': '☕',
            '.cpp': '⚙️', '.c': '⚙️', '.sh': '📜', '.yml': '⚙️',
            '.yaml': '⚙️', '.xml': '📄', '.svg': '🖼️', '.png': '🖼️',
            '.jpg': '🖼️', '.gif': '🖼️', '.pdf': '📕'
        };
        
        return icons[item.extension] || '📄';
    }

    async previewFile(filePath) {
        // Implementation for file preview modal
        this.showFilePreview(filePath);
    }
}
```

### Security Considerations

#### Path Validation
- Validate all file paths to prevent directory traversal
- Restrict access to workspace directory only
- Sanitize file paths before processing

#### File Size Limits
- Maximum file size for preview: 100KB
- Maximum lines displayed: 1000
- Implement streaming for large files

#### Access Control
- Use existing authentication system
- Apply same session/token validation
- Rate limiting for file operations

## User Experience

### Mobile Optimizations
- **Touch-friendly**: 44px minimum tap targets
- **Responsive**: Adapts to different screen sizes
- **Gesture support**: Swipe to close modals
- **Loading states**: Show spinners during file operations
- **Error handling**: User-friendly error messages

### Performance
- **Lazy loading**: Load file tree on demand
- **Caching**: Cache file tree structure
- **Debounced search**: 300ms delay for search input
- **Virtual scrolling**: For large directories

### Accessibility
- **Screen reader support**: Proper ARIA labels
- **Keyboard navigation**: Tab through file tree
- **High contrast**: Readable in all themes
- **Focus indicators**: Clear focus states

## Implementation Phases

### Phase 1: Basic File Tree
- Add file explorer section to mobile interface
- Implement basic directory browsing
- Add expand/collapse functionality

### Phase 2: File Preview
- Add preview modal with syntax highlighting
- Support common file types
- Add file metadata display

### Phase 3: Search & Filters
- Implement file content search
- Add file type filters
- Add recently accessed files

### Phase 4: Advanced Features
- Add file breadcrumb navigation
- Implement file bookmarks
- Add workspace switching

## Testing Strategy

### Unit Tests
- File path validation
- Tree structure rendering
- Search functionality

### Integration Tests
- API endpoint responses
- Authentication flow
- Error handling

### Mobile Testing
- iOS Safari and Chrome
- Android Chrome and Samsung Browser
- Different screen sizes and orientations
- Touch gesture interactions

## Deployment Considerations

### Backwards Compatibility
- Feature is additive to existing interface
- Graceful degradation if APIs fail
- No breaking changes to current functionality

### Performance Impact
- Minimal impact on existing features
- Optional loading (collapsed by default)
- Efficient file system operations

### Configuration
- Add settings for max file size
- Configure ignored file patterns
- Set default expanded state