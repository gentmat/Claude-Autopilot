// Modal dialogs and user interactions
import { validateMessage } from '../security/validation.js';
import { sendEditMessage } from '../communication/vscode-api.js';
import { showError } from '../utils/dom-helpers.js';

export function showEditDialog(message, messageId) {
  // Remove any existing edit dialog
  const existingDialog = document.getElementById('editDialog');
  if (existingDialog) {
    existingDialog.remove();
  }

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.id = 'editDialog';
  overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

  // Create dialog box
  const dialog = document.createElement('div');
  dialog.style.cssText = `
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        padding: 20px;
        min-width: 400px;
        max-width: 600px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

  // Create dialog content
  const title = document.createElement('h3');
  title.textContent = 'Edit Message';
  title.style.cssText = `
        margin: 0 0 15px 0;
        color: var(--vscode-foreground);
        font-size: 16px;
    `;

  const textarea = document.createElement('textarea');
  textarea.value = message.text;
  textarea.style.cssText = `
        width: 100%;
        height: 100px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        padding: 8px;
        font-family: var(--vscode-font-family);
        font-size: 13px;
        resize: vertical;
        box-sizing: border-box;
    `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 15px;
    `;

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
        padding: 6px 12px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 3px;
        cursor: pointer;
    `;

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = `
        padding: 6px 12px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
    `;

  // Event handlers
  cancelBtn.onclick = () => {
    console.log('Edit cancelled by user');
    overlay.remove();
  };

  saveBtn.onclick = () => {
    const newText = textarea.value.trim();
    console.log('User entered text:', newText);
        
    if (newText === '') {
      showError('Message cannot be empty');
      return;
    }

    const validation = validateMessage(newText);
    console.log('Validation result:', validation);
        
    if (!validation.valid) {
      showError(validation.error);
      return;
    }

    console.log('Sending editMessage command to backend');
    sendEditMessage(messageId, newText);

    overlay.remove();
  };

  // Handle Enter key to save
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      saveBtn.click();
    }
    if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });

  // Assemble dialog
  buttonContainer.appendChild(cancelBtn);
  buttonContainer.appendChild(saveBtn);
    
  dialog.appendChild(title);
  dialog.appendChild(textarea);
  dialog.appendChild(buttonContainer);
    
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Focus the textarea and select all text
  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 100);

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      cancelBtn.click();
    }
  };
}