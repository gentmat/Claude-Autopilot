// Main entry point - initializes all modules and sets up event handlers
import { addMessage } from './ui/session-controls.js';
import { updateButtonStates } from './ui/queue-manager.js';
import { sendChatMessage, clearChatHistory } from './ui/chat-manager.js';
import { loadHistory } from './features/history-manager.js';
import { requestDevelopmentModeSetting } from './features/development-tools.js';
import { sendGetSkipPermissionsSetting, sendUpdateSkipPermissionsSetting, sendGetHistoryVisibilitySetting } from './communication/vscode-api.js';
import { requestWebServerStatus, startWebServerStatusPolling } from './features/web-interface.js';
import { setupMessageHandler } from './communication/message-handler.js';
import { 
  showFileAutocomplete, 
  hideFileAutocomplete, 
  updateFileAutocomplete, 
  handleAutocompleteNavigation,
  fileAutocompleteState 
} from './features/file-autocomplete.js';
import { sendClaudeKeypress } from './communication/vscode-api.js';
import { flushPendingClaudeOutput } from './ui/output-handlers.js';

// Initialize the application
function initialize() {
  console.log('🚀 DEBUG: Application initialization starting');

  // Add global error handler
  window.addEventListener('error', function(event) {
    console.error('❌ GLOBAL ERROR:', event.error);
    console.error('❌ ERROR DETAILS:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });
  });

  // Add unhandled promise rejection handler
  window.addEventListener('unhandledrejection', function(event) {
    console.error('❌ UNHANDLED PROMISE REJECTION:', event.reason);
  });

  // Wait for DOM to be ready
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        console.log('📄 DEBUG: DOM content loaded');
        doInitialize();
      });
    } else {
      console.log('📄 DEBUG: DOM already ready');
      doInitialize();
    }
  } catch (error) {
    console.error('❌ CRITICAL ERROR during initialization setup:', error);
  }
}

function doInitialize() {
  try {
    console.log('⚙️ DEBUG: Starting actual initialization');

    // Check if messageInput exists
    const messageInput = document.getElementById('messageInput');
    console.log('🔍 DEBUG: messageInput element at start:', !!messageInput);

    // Set up message handler for VS Code communication
    try {
      setupMessageHandler();
      console.log('✅ DEBUG: Message handler setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup message handler:', error);
    }

    // Set up accordions FIRST (before other UI elements)
    try {
      setupAccordions();
      console.log('✅ DEBUG: Accordions setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup accordions:', error);
    }

    // Initialize button states and load history
    try {
      updateButtonStates();
      loadHistory();
      console.log('✅ DEBUG: Button states and history setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup button states/history:', error);
    }

    // Check if development mode is enabled
    try {
      requestDevelopmentModeSetting();
      console.log('✅ DEBUG: Development mode request sent');
    } catch (error) {
      console.error('❌ DEBUG: Failed to request development mode:', error);
    }

    // Request initial skip permissions setting
    try {
      sendGetSkipPermissionsSetting();
      console.log('✅ DEBUG: Skip permissions request sent');
    } catch (error) {
      console.error('❌ DEBUG: Failed to request skip permissions:', error);
    }

    // Request initial history visibility setting
    try {
      sendGetHistoryVisibilitySetting();
      console.log('✅ DEBUG: History visibility request sent');
    } catch (error) {
      console.error('❌ DEBUG: Failed to request history visibility:', error);
    }

    // Request initial web server status and start polling
    try {
      requestWebServerStatus();
      startWebServerStatusPolling();
      console.log('✅ DEBUG: Web server status and polling setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup web server status:', error);
    }

    // Set up keyboard event handlers
    try {
      setupKeyboardHandlers();
      console.log('✅ DEBUG: Keyboard handlers setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup keyboard handlers:', error);
    }

    // Set up Claude output keyboard navigation
    try {
      setupClaudeOutputNavigation();
      console.log('✅ DEBUG: Claude output navigation setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup Claude output navigation:', error);
    }

    // Set up file autocomplete handlers
    try {
      setupFileAutocompleteHandlers();
      console.log('✅ DEBUG: File autocomplete setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup file autocomplete:', error);
    }

    // Set up cleanup handlers
    try {
      setupCleanupHandlers();
      console.log('✅ DEBUG: Cleanup handlers setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup cleanup handlers:', error);
    }

    // Set up skip permissions change handler
    try {
      setupSkipPermissionsHandler();
      console.log('✅ DEBUG: Skip permissions handler setup complete');
    } catch (error) {
      console.error('❌ DEBUG: Failed to setup skip permissions handler:', error);
    }

    console.log('✅ DEBUG: Initialization complete');
  } catch (error) {
    console.error('❌ CRITICAL ERROR during initialization:', error);
  }
}

function setupAccordions() {
  console.log('🎵 DEBUG: Setting up accordions...');

  // Generic accordion toggling using data-target attribute
  const accordionHeaders = document.querySelectorAll('.accordion .accordion-header');
  console.log('🔍 DEBUG: Found accordion headers:', accordionHeaders.length);

  if (accordionHeaders.length === 0) {
    console.warn('⚠️ DEBUG: No accordion headers found!');
    return;
  }

  accordionHeaders.forEach((header, index) => {
    console.log(`📝 DEBUG: Setting up accordion ${index + 1}:`, header.textContent.trim());

    header.addEventListener('click', function(event) {
      console.log(`🖱️ DEBUG: Accordion ${index + 1} clicked`);

      const targetSelector = this.getAttribute('data-target');
      console.log(`🎯 DEBUG: Target selector:`, targetSelector);

      if (!targetSelector) {
        console.warn(`⚠️ DEBUG: No data-target found for accordion ${index + 1}`);
        return;
      }

      const content = document.querySelector(targetSelector);
      console.log(`📦 DEBUG: Target content element found:`, !!content);

      if (!content) {
        console.warn(`⚠️ DEBUG: Target content not found for selector: ${targetSelector}`);
        return;
      }

      const isHidden = content.style.display === 'none' || getComputedStyle(content).display === 'none';
      console.log(`👁️ DEBUG: Content is currently hidden:`, isHidden);

      content.style.display = isHidden ? 'block' : 'none';
      console.log(`✅ DEBUG: Content display set to:`, content.style.display);
    });
  });

  console.log('✅ DEBUG: Accordions setup complete');
}

function setupKeyboardHandlers() {
  const messageInput = document.getElementById('messageInput');

  // DEBUG: Log when setupKeyboardHandlers is called
  console.log('🔧 DEBUG: setupKeyboardHandlers called');
  console.log('🔧 DEBUG: messageInput element found:', !!messageInput);

  if (!messageInput) {
    console.error('❌ DEBUG: messageInput element not found!');
    // Try again after a short delay
    setTimeout(() => {
      const retryInput = document.getElementById('messageInput');
      if (retryInput) {
        console.log('🔄 DEBUG: Retrying keyboard handler setup');
        setupKeyboardHandlers();
      } else {
        console.error('❌ DEBUG: Still cannot find messageInput element after retry');
      }
    }, 1000);
    return;
  }

  // Remove any existing listeners to avoid duplicates
  const newHandler = function (event) {
    // DEBUG: Log all keydown events
    console.log('⌨️ DEBUG: Keydown event - key:', event.key, 'shiftKey:', event.shiftKey, 'target:', event.target.id);

    // Handle autocomplete navigation first
    if (handleAutocompleteNavigation(event)) {
      console.log('🔍 DEBUG: Autocomplete navigation handled event');
      return;
    }

    if (event.key === 'Enter') {
      console.log('📤 DEBUG: Enter key detected');
      if (event.shiftKey) {
        console.log('📝 DEBUG: Shift+Enter - allowing newline');
        // Allow newline insertion
        return;
      }
      console.log('🚀 DEBUG: Enter only - preventing default and sending message');
      // Prevent default newline and send message
      event.preventDefault();
      sendChatMessage(); // Send message in real-time
    }
  };

  // Remove existing listeners and add new one
  messageInput.removeEventListener('keydown', messageInput._keydownHandler);
  messageInput.addEventListener('keydown', newHandler);
  messageInput._keydownHandler = newHandler;

  console.log('✅ DEBUG: Keyboard handler attached successfully');

  // Test the handler with a simple verification
  messageInput.addEventListener('focus', function() {
    console.log('🎯 DEBUG: messageInput focused - keyboard handler should be active');
  });
}

function setupClaudeOutputNavigation() {
  // Handle keyboard navigation in Claude output area
  const claudeOutput = document.getElementById('claudeOutputContainer');

  // Make the Claude output area focusable
  claudeOutput.addEventListener('click', function () {
    const outputElement = claudeOutput.querySelector('.claude-live-output');
    if (outputElement) {
      outputElement.focus();
    }
  });

  // Handle keyboard navigation when Claude output is focused
  claudeOutput.addEventListener('keydown', function (event) {
    const outputElement = claudeOutput.querySelector('.claude-live-output');
    if (!outputElement || document.activeElement !== outputElement) {
      return;
    }

    switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      sendClaudeKeypress('up');
      break;
    case 'ArrowDown':
      event.preventDefault();
      sendClaudeKeypress('down');
      break;
    case 'ArrowLeft':
      event.preventDefault();
      sendClaudeKeypress('left');
      break;
    case 'ArrowRight':
      event.preventDefault();
      sendClaudeKeypress('right');
      break;
    case 'Enter':
      event.preventDefault();
      sendClaudeKeypress('enter');
      break;
    case 'Escape':
      event.preventDefault();
      sendClaudeKeypress('escape');
      break;
    }
  });
}

function setupFileAutocompleteHandlers() {
  // Handle input changes to detect @ symbol and update autocomplete
  document.getElementById('messageInput').addEventListener('input', function (event) {
    const textarea = event.target;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
      
    // Find the last @ symbol before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      
    if (lastAtIndex !== -1) {
      // Check if @ is at start or preceded by whitespace
      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || charBeforeAt === '\t' || lastAtIndex === 0) {
        // Extract query after @
        const queryAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
              
        // Check if query contains spaces or newlines (invalid for file reference)
        if (!queryAfterAt.includes(' ') && !queryAfterAt.includes('\n') && !queryAfterAt.includes('\t')) {
          if (!fileAutocompleteState.isOpen) {
            showFileAutocomplete(textarea, lastAtIndex);
          } else if (queryAfterAt !== fileAutocompleteState.query) {
            updateFileAutocomplete(queryAfterAt);
          }
          return;
        }
      }
    }
      
    // Hide autocomplete if conditions not met
    if (fileAutocompleteState.isOpen) {
      hideFileAutocomplete();
    }
  });

  // Hide autocomplete when clicking outside
  document.addEventListener('click', function (event) {
    const autocompleteContainer = document.getElementById('fileAutocompleteContainer');
    const messageInput = document.getElementById('messageInput');
      
    if (fileAutocompleteState.isOpen && 
          !autocompleteContainer?.contains(event.target) && 
          event.target !== messageInput) {
      hideFileAutocomplete();
    }
  });
}

function setupCleanupHandlers() {
  // Cleanup function to flush any pending Claude output before page closes
  window.addEventListener('beforeunload', function() {
    flushPendingClaudeOutput();
  });
}

function setupSkipPermissionsHandler() {
  // Handle changes to the skip permissions checkbox
  const skipPermissionsCheckbox = document.getElementById('skipPermissions');
  if (skipPermissionsCheckbox) {
    skipPermissionsCheckbox.addEventListener('change', function(event) {
      sendUpdateSkipPermissionsSetting(event.target.checked);
    });
  }
}


// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initialize();
});

// Import all modules needed for global access
import { startProcessing, stopProcessing, interruptClaude, resetSession, openSettings } from './ui/session-controls.js';
import { clearQueue, handleDragStart, handleDragOver, handleDrop } from './ui/queue-manager.js';
import { clearClaudeOutput } from './ui/output-handlers.js';
import { filterHistory, deleteAllHistory } from './features/history-manager.js';
import { simulateUsageLimit, clearAllTimers, debugQueueState, toggleDebugMode } from './features/development-tools.js';
import { startWebInterface, stopWebInterface, showWebInterfaceQR, openWebInterface } from './features/web-interface.js';

// Export commonly used functions for global access (for HTML onclick handlers)
window.addMessage = addMessage;
window.startProcessing = startProcessing;
window.stopProcessing = stopProcessing;
window.interruptClaude = interruptClaude;
window.resetSession = resetSession;
window.openSettings = openSettings;
window.clearQueue = clearQueue;
window.clearClaudeOutput = clearClaudeOutput;
window.loadHistory = loadHistory;
window.filterHistory = filterHistory;
window.deleteAllHistory = deleteAllHistory;
window.simulateUsageLimit = simulateUsageLimit;
window.clearAllTimers = clearAllTimers;
window.debugQueueState = debugQueueState;
window.toggleDebugMode = toggleDebugMode;
window.startWebInterface = startWebInterface;
window.stopWebInterface = stopWebInterface;
window.showWebInterfaceQR = showWebInterfaceQR;
window.openWebInterface = openWebInterface;
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;

// DEBUG: Test function for keyboard handler
window.testKeyboardHandler = function() {
  console.log('🧪 DEBUG: Testing keyboard handler...');

  const messageInput = document.getElementById('messageInput');
  console.log('🔍 DEBUG: messageInput element:', !!messageInput);

  if (messageInput) {
    console.log('📝 DEBUG: messageInput value length:', messageInput.value.length);
    console.log('📝 DEBUG: messageInput has listeners:', !!messageInput._keydownHandler);
    console.log('🎯 DEBUG: Focusing message input...');
    messageInput.focus();

    // Simulate Enter key press
    console.log('⌨️ DEBUG: Simulating Enter key press...');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: false,
      bubbles: true,
      cancelable: true
    });
    messageInput.dispatchEvent(event);
  } else {
    console.error('❌ DEBUG: messageInput not found!');
  }
};