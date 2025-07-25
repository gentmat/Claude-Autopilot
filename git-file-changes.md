# Git File Changes Feature Specification

## Overview
Add git file changes tracking and diff viewing capabilities to the Claude Autopilot web interface, allowing users to monitor modified files on the current branch and view detailed diffs between working directory, staged changes, and previous commits.

## Core Requirements

### 1. Git Status Integration
- **Display modified files** on current branch with status indicators
- **Show file types**: Modified (M), Added (A), Deleted (D), Renamed (R), Copied (C), Untracked (??)
- **Track staging status**: Staged, unstaged, or both
- **Real-time updates** when files change in the workspace
- **Branch information**: Current branch name and latest commit info

### 2. File Diff Viewer
- **Side-by-side diff view** for modified files
- **Unified diff view** option for mobile/narrow screens
- **Syntax highlighting** for both old and new content
- **Line numbers** and change indicators (+/- markers)
- **Support multiple diff comparisons**:
  - Working directory vs. staged
  - Working directory vs. last commit (HEAD)
  - Staged vs. last commit (HEAD)
  - Current branch vs. main/master branch

### 3. Web Interface Integration
- **New "Git Changes" tab** in the mobile web interface
- **File changes sidebar** in desktop web view
- **Quick access buttons** for common git operations (stage, unstage, discard)
- **Responsive design** that works on mobile devices
- **Integration with existing file explorer** (cross-navigation)

## Detailed Features

### Phase 1: Basic Git Status Display
#### Backend API Endpoints
- `GET /api/git/status` - Get current git status with file changes
- `GET /api/git/branch-info` - Get current branch and commit information
- `GET /api/git/file-diff/:filePath` - Get diff for specific file

#### Frontend Components
- Git status display component with file list
- Status indicators (icons/colors for each file type)
- Branch information header
- Basic responsive layout

#### Data Structure
```json
{
  "branch": "feature/mobile-interface",
  "ahead": 2,
  "behind": 0,
  "lastCommit": {
    "hash": "6d4d4a5",
    "message": "feat: add file explorer API...",
    "author": "Ben Basha",
    "date": "2025-01-25T10:30:00Z"
  },
  "files": [
    {
      "path": "src/services/mobile/index.ts",
      "status": "modified",
      "staged": false,
      "unstaged": true,
      "additions": 45,
      "deletions": 12
    }
  ]
}
```

### Phase 2: Diff Viewing Implementation
#### Backend Enhancements
- `GET /api/git/diff/:filePath?compare=working|staged|head` - Get detailed diff
- `POST /api/git/stage` - Stage file changes
- `POST /api/git/unstage` - Unstage file changes
- `POST /api/git/discard` - Discard working directory changes

#### Frontend Enhancements
- Split-pane diff viewer component
- Syntax highlighting using Prism.js or similar
- Line-by-line comparison with highlighting
- Expandable context lines
- Mobile-optimized unified diff view

#### Security Considerations
- Validate all file paths to prevent directory traversal
- Limit diff size to prevent memory issues (max 10MB files)
- Sanitize git command outputs
- Rate limiting on git operations

### Phase 3: Advanced Features & Polish
#### Advanced Diff Features
- **Multiple comparison modes**:
  - Working vs. Staged
  - Working vs. HEAD
  - Staged vs. HEAD  
  - Current branch vs. main
- **Diff statistics**: Lines added/removed, file size changes
- **Binary file handling**: Show file type and size changes
- **Image diff support**: Side-by-side image comparison for image files
- **Whitespace options**: Show/hide whitespace changes

#### UI/UX Enhancements
- **Search and filter** files by name or status
- **Collapsible file groups** (modified, added, deleted)
- **Keyboard shortcuts** for navigation
- **Drag and drop** to stage/unstage files
- **Batch operations**: Stage/unstage multiple files

#### Integration Features
- **Integration with queue system**: Add changed files to message queue
- **Quick commit interface**: Commit directly from web interface
- **File history**: View commit history for specific files
- **Blame view**: Line-by-line authorship information

## Technical Implementation

### Backend Architecture
```
src/services/git/
├── index.ts          # Main git service
├── status.ts         # Git status operations
├── diff.ts           # Diff generation and parsing
├── operations.ts     # Stage/unstage/discard operations
└── security.ts       # Path validation and security
```

### Frontend Architecture
```
src/webview/git/
├── components/
│   ├── GitStatus.js      # File status list
│   ├── DiffViewer.js     # Diff display component
│   ├── BranchInfo.js     # Branch and commit info
│   └── FileOperations.js # Stage/unstage controls
├── styles/
│   ├── git-status.css    # Git status styling
│   └── diff-viewer.css   # Diff viewer styling
└── git-api.js           # API communication
```

### Security Requirements
- **Path validation**: Ensure all file paths are within workspace
- **Command injection prevention**: Sanitize all git command parameters
- **File size limits**: Limit diff operations to reasonable file sizes
- **Rate limiting**: Prevent abuse of git operations
- **Access control**: Ensure web interface authentication

### Performance Considerations
- **Caching**: Cache git status and diff results for 30 seconds
- **Streaming**: Stream large diffs instead of loading entirely in memory
- **Debouncing**: Debounce file system watchers to prevent excessive updates
- **Lazy loading**: Load diffs only when requested
- **Virtual scrolling**: For large file lists and diff outputs

### Error Handling
- **Git command failures**: Graceful handling of git errors
- **Network timeouts**: Proper timeout handling for API calls
- **Invalid file paths**: Clear error messages for invalid requests
- **Repository state**: Handle cases where git repo is in conflicted state
- **Permission errors**: Handle read/write permission issues

## Testing Requirements

### Unit Tests
- Git command execution and parsing
- Path validation and security functions
- Diff parsing and formatting
- API endpoint responses

### Integration Tests
- End-to-end git operations workflow
- Web interface interactions
- Mobile responsiveness
- Cross-browser compatibility

### Manual Testing Scenarios
- Various git states (clean, dirty, conflicted)
- Different file types (text, binary, images)
- Large files and repositories
- Network connectivity issues
- Mobile device testing

## Success Metrics
- **Functionality**: All git operations work correctly
- **Performance**: Diff loading under 2 seconds for typical files
- **Usability**: Intuitive interface that works on mobile
- **Reliability**: No crashes or data corruption
- **Security**: No path traversal or command injection vulnerabilities

## Future Enhancements
- **Merge conflict resolution**: Visual merge conflict resolution
- **Stash management**: Create and manage git stashes
- **Branch operations**: Create, switch, and merge branches
- **Remote operations**: Push, pull, and fetch from remotes
- **Git hooks integration**: Trigger actions on git operations