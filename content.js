(function() {
  // Only run in the main frame, not in iframes
  if (window.self !== window.top) {
    // This is an iframe, don't initialize
    return;
  }

  let blocked = false;
let start = null;
let after = 120000;
let timer = null;
let hoverOnlyMode = false;
let unlockPassword = '';
let clickCount = 0;
let unlocked = false;
let lastActivity = Date.now();
let menuButton = null;
let menuContainer = null;
let menuVisible = false;
let isPaused = false;
let timerDisplay = null;
let currentTabTimer = null;
let unlockClickCount = 0;
let lastUserActivity = Date.now();
let inactivityTimer = null;
let unlockInProgress = false;

// Initialize content script - check if kiosk mode is running
function initializeContentScript() {
  try {
    chrome.runtime.sendMessage({action: 'getStatus'}, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Extension context invalidated, skipping initialization');
        return;
      }

      if (response && response.isRunning) {
        console.log('Kiosk mode is running, requesting current state');
        // Request the current state to restore buttons and timer
        chrome.runtime.sendMessage({action: 'requestCurrentState'});
      }
    });
  } catch (e) {
    console.log('Failed to initialize content script:', e);
  }
}

// Call initialization when content script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeContentScript();
    // Force create button for testing
    setTimeout(() => {
      console.log('Force creating button after DOM ready');
      createControlButtons();
    }, 1000);
  });
} else {
  initializeContentScript();
  // Force create button for testing
  setTimeout(() => {
    console.log('Force creating button immediately');
    createControlButtons();
  }, 1000);
}

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'updateClickBlock') {
    start = req.startTime;
    after = req.blockAfter;
    hoverOnlyMode = req.hoverOnlyMode || false;
    unlockPassword = req.unlockPassword || '';
    // Only update unlocked state from background if it's explicitly provided and different
    if (req.hasOwnProperty('unlocked') && req.unlocked !== unlocked) {
      console.log('Updating unlocked state from background:', req.unlocked);
      unlocked = req.unlocked;
    }
    clickCount = 0;
    unlockClickCount = 0;
    isPaused = false;
    currentTabTimer = req.currentTabTimer;
    schedule();
    // Only create menu button if it doesn't exist
    if (!menuButton) {
      createControlButtons();
    } else {
      updateButtonVisibility();
    }
    createTimerDisplay(); // This now just updates the menu button
    if (unlocked) {
      startInactivityTimer();
    }
  } else if (req.action === 'updateTimer') {
    currentTabTimer = req.currentTabTimer;
    updateTimerDisplay();
  } else if (req.action === 'updateUnlockState') {
    unlocked = req.unlocked;
    updateButtonVisibility();
  } else if (req.action === 'updatePauseState') {
    isPaused = req.isPaused;
    updateButtonVisibility();
    if (isPaused) {
      // Clear any existing timers when paused globally
      if (timer) clearTimeout(timer);
    } else {
      // Resume scheduling when resumed globally
      schedule();
    }
  } else if (req.action === 'enterFullscreen') {
    enterFullscreen();
  } else if (req.action === 'exitFullscreen') {
    exitFullscreen();
  } else if (req.action === 'tabBecameActive') {
    // Don't create new menu button if it already exists
    if (!menuButton) {
      createControlButtons();
    }
    createTimerDisplay(); // This now just updates the menu button
    if (unlocked) {
      startInactivityTimer();
    }
  } else if (req.action === 'tabBecameInactive') {
    removeControlButtons();
    removeTimerDisplay();
    stopInactivityTimer();
  }
});

function schedule() {
  if (!start) return;
  const elapsed = Date.now() - start;
  blocked = elapsed >= after;

  if (timer) clearTimeout(timer);
  if (!blocked) {
    timer = setTimeout(() => {
      blocked = true;
      console.log('Click blocking activated');
      showBlockNotification();
    }, after - elapsed);
  }
}

function showBlockNotification() {
  // Create a subtle notification that clicks are blocked
  const notification = document.createElement('div');
  notification.id = 'kiosk-block-notification';
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(255, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 999999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = 'Interaction Locked';

  document.body.appendChild(notification);

  // Fade in
  setTimeout(() => notification.style.opacity = '1', 100);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

const block = (e) => {
  // Always allow clicks on control buttons
  if (e.target) {
    // Direct ID check
    if (e.target.id === 'kiosk-menu-button' ||
        e.target.id === 'kiosk-menu-container' ||
        e.target.classList.contains('kiosk-menu-btn')) {
      return;
    }

    // Check if target has closest method (only elements have this method)
    if (typeof e.target.closest === 'function') {
      if (e.target.closest('#kiosk-menu-button') ||
          e.target.closest('#kiosk-menu-container') ||
          e.target.closest('.kiosk-menu-btn')) {
        return;
      }
    }
  }

  // Don't block if unlocked
  if (unlocked) {
    console.log('User is unlocked - allowing interaction');
    trackUserActivity();
    return;
  }

  // Block all clicks if unlock is in progress
  if (unlockInProgress) {
    console.log('Unlock in progress - blocking click');
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }

  const shouldBlock = blocked || (hoverOnlyMode && !isHoverEvent(e.type));

  if (shouldBlock) {
    // Handle unlock sequence
    if (e.type === 'click') {
      unlockClickCount++;
      trackUserActivity();

      if (unlockClickCount === 5) {
        unlockInProgress = true;
        attemptUnlock();
        // Still block the 5th click event while unlock process happens
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
      }

      if (unlockClickCount > 5) unlockClickCount = 1;

      // Visual feedback for blocked clicks
      showClickBlockedFeedback(e.clientX, e.clientY);

      // Show progress towards unlock
      if (unlockClickCount === 1) {
        showNotification(`Click ${5 - unlockClickCount} more times to unlock`, 'rgba(255, 193, 7, 0.9)', '#000');
      } else if (unlockClickCount > 1 && unlockClickCount < 5) {
        showNotification(`Click ${5 - unlockClickCount} more times to unlock`, 'rgba(255, 193, 7, 0.9)', '#000');
      }
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }
};

function isHoverEvent(eventType) {
  return ['mouseover', 'mouseenter', 'mouseleave', 'mousemove'].includes(eventType);
}

function showClickBlockedFeedback(x, y) {
  const feedback = document.createElement('div');
  feedback.style.cssText = `
    position: fixed;
    left: ${x - 10}px;
    top: ${y - 10}px;
    width: 20px;
    height: 20px;
    background: rgba(255, 0, 0, 0.7);
    border-radius: 50%;
    pointer-events: none;
    z-index: 999999;
    animation: pulse 0.5s ease-out;
  `;

  // Add pulse animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.5); opacity: 1; }
      100% { transform: scale(2); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(feedback);

  setTimeout(() => {
    if (feedback.parentNode) {
      feedback.parentNode.removeChild(feedback);
    }
    if (style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }, 500);
}

function hideBlockNotification() {
  const notification = document.getElementById('kiosk-block-notification');
  if (notification) {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }
}

function showUnlockNotification() {
  showNotification('Screen Unlocked - Content Accessible', 'rgba(0, 128, 0, 0.8)');
}

function showIncorrectPasswordNotification() {
  showNotification('Incorrect Password - Access Denied', 'rgba(255, 128, 0, 0.8)');
}


function createControlButtons() {
  console.log('createControlButtons called, start:', start, 'kiosk running checks');

  // Check if menu button already exists
  const existingMenu = document.getElementById('kiosk-menu-button');
  if (existingMenu) {
    console.log('Menu button already exists, updating');
    menuButton = existingMenu;
    updateMenuButton();
    return;
  }

  // Always clean up existing elements first
  removeControlButtons();

  // Create button even without start time for testing
  console.log('Creating new menu button (forcing creation for debugging)');

  // Create main round menu button with timer
  menuButton = document.createElement('div');
  menuButton.id = 'kiosk-menu-button';
  menuButton.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    text-align: center;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border: 3px solid rgba(255, 255, 255, 0.3);
  `;

  // Create timer display inside the button
  const timerContent = document.createElement('div');
  timerContent.id = 'menu-timer-display';
  timerContent.style.cssText = `
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 2px;
  `;
  timerContent.textContent = '00:30';

  const statusText = document.createElement('div');
  statusText.id = 'menu-status-text';
  statusText.style.cssText = `
    font-size: 8px;
    opacity: 0.9;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `;
  statusText.textContent = isPaused ? 'PAUSED' : 'MENU';

  menuButton.appendChild(timerContent);
  menuButton.appendChild(statusText);
  menuButton.onclick = toggleMenu;

  // Create menu container (hidden by default)
  createMenuContainer();

  document.body.appendChild(menuButton);
  console.log('Menu button added to DOM');
  updateMenuButton();
}

function createMenuContainer() {
  menuContainer = document.createElement('div');
  menuContainer.id = 'kiosk-menu-container';
  menuContainer.style.cssText = `
    position: fixed;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%) scale(0);
    opacity: 0;
    background: rgba(0, 0, 0, 0.9);
    border-radius: 20px;
    padding: 15px;
    z-index: 999999;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    backdrop-filter: blur(10px);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    gap: 10px;
    pointer-events: none;
  `;

  // Create menu buttons
  const buttons = [
    { id: 'pause', text: isPaused ? '▶️ Resume' : '⏸️ Pause', action: togglePause },
    { id: 'next', text: '⏭️ Next', action: switchToNextTab },
    ...(unlocked ? [
      { id: 'lock', text: '🔒 Lock', action: performLock },
      { id: 'exit', text: '❌ Exit', action: exitKiosk }
    ] : [])
  ];

  buttons.forEach(btn => {
    const button = document.createElement('div');
    button.className = 'kiosk-menu-btn';
    button.textContent = btn.text;
    button.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 10px 15px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
      white-space: nowrap;
      min-width: 70px;
      text-align: center;
    `;

    button.onmouseover = () => {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    };

    button.onmouseout = () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = 'none';
    };

    button.onclick = () => {
      btn.action();
      hideMenu();
    };

    menuContainer.appendChild(button);
  });

  document.body.appendChild(menuContainer);
}

function removeControlButtons() {
  if (menuButton && menuButton.parentNode) {
    menuButton.parentNode.removeChild(menuButton);
    menuButton = null;
  }
  if (menuContainer && menuContainer.parentNode) {
    menuContainer.parentNode.removeChild(menuContainer);
    menuContainer = null;
  }
  menuVisible = false;
}

function updateButtonVisibility() {
  updateMenuButton();
}

function updateMenuButton() {
  if (!menuButton) return;

  const timerContent = document.getElementById('menu-timer-display');
  const statusText = document.getElementById('menu-status-text');

  if (timerContent && currentTabTimer) {
    const minutes = Math.floor(currentTabTimer.remaining / 60);
    const seconds = currentTabTimer.remaining % 60;
    timerContent.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  if (statusText) {
    statusText.textContent = isPaused ? 'PAUSED' : 'MENU';
  }

  // Update button color based on state
  const isLocked = !unlocked;
  const bgColor = isPaused
    ? 'linear-gradient(135deg, #ffc107 0%, #ff9800 100%)'
    : isLocked
      ? 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)'
      : 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';

  menuButton.style.background = bgColor;
}

function toggleMenu() {
  if (menuVisible) {
    hideMenu();
  } else {
    showMenu();
  }
}

function showMenu() {
  if (!menuContainer) return;

  // Recreate menu to update button states
  if (menuContainer.parentNode) {
    menuContainer.parentNode.removeChild(menuContainer);
  }
  createMenuContainer();

  menuVisible = true;
  menuContainer.style.pointerEvents = 'auto';
  menuContainer.style.transform = 'translateX(-50%) scale(1)';
  menuContainer.style.opacity = '1';
}

function hideMenu() {
  if (!menuContainer) return;

  menuVisible = false;
  menuContainer.style.pointerEvents = 'none';
  menuContainer.style.transform = 'translateX(-50%) scale(0)';
  menuContainer.style.opacity = '0';
}

function togglePause() {
  isPaused = !isPaused;

  if (isPaused) {
    // Clear any existing timers
    if (timer) clearTimeout(timer);
    chrome.runtime.sendMessage({action: 'pause'});
    showPauseNotification();
  } else {
    chrome.runtime.sendMessage({action: 'continue'});
    schedule();
    showResumeNotification();
  }

  updateButtonVisibility();
}

function switchToNextTab() {
  chrome.runtime.sendMessage({action: 'forceNextTab'});
  showNextTabNotification();
}

function exitKiosk() {
  chrome.runtime.sendMessage({action: 'exitKiosk'});
  showExitNotification();
}

function attemptUnlock() {
  if (!unlockPassword) {
    // If no password is set, unlock immediately
    performUnlock();
    return;
  }

  // Prompt for password
  setTimeout(() => {
    const enteredPassword = prompt('Enter password to unlock restrictions:');
    if (enteredPassword === unlockPassword) {
      performUnlock();
    } else if (enteredPassword !== null) { // null means user cancelled
      showIncorrectPasswordNotification();
      console.log('Incorrect password entered');
      // Reset click count on failed password
      unlockClickCount = 0;
      unlockInProgress = false;
    } else {
      // User cancelled prompt, reset click count
      unlockClickCount = 0;
      unlockInProgress = false;
    }
  }, 100);
}

function performUnlock() {
  console.log('performUnlock called - setting unlocked to true');
  unlocked = true;
  unlockClickCount = 0;
  unlockInProgress = false; // Clear the unlock in progress flag

  // Notify all tabs about unlock state
  chrome.runtime.sendMessage({action: 'setGlobalUnlock', data: true});

  showUnlockNotification();
  updateButtonVisibility();
  startInactivityTimer();
}

function performLock() {
  unlocked = false;
  unlockClickCount = 0;
  unlockInProgress = false;

  // Notify all tabs about lock state
  chrome.runtime.sendMessage({action: 'setGlobalUnlock', data: false});

  showLockNotification();
  updateButtonVisibility();
  stopInactivityTimer();
}

function trackUserActivity() {
  lastUserActivity = Date.now();
  if (unlocked) {
    startInactivityTimer(); // Restart the 5-minute timer
  }
}

function startInactivityTimer() {
  stopInactivityTimer();
  if (unlocked) {
    inactivityTimer = setTimeout(() => {
      performLock();
      showInactivityLockNotification();
    }, 5 * 60 * 1000); // 5 minutes
  }
}

function stopInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function createTimerDisplay() {
  // Timer is now integrated into the menu button - no separate display needed
  updateMenuButton();
}

function removeTimerDisplay() {
  // Timer is now integrated into the menu button - no separate display to remove
}

function updateTimerDisplay() {
  // Timer is now integrated into the menu button
  updateMenuButton();
}

function showPauseNotification() {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 60px;
    left: 10px;
    background: rgba(255, 193, 7, 0.9);
    color: #000;
    padding: 8px 16px;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    z-index: 999999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = 'Timer Paused - Clicks Unlocked';

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

function showResumeNotification() {
  showNotification('Timer Resumed', 'rgba(40, 167, 69, 0.9)');
}

function showNextTabNotification() {
  showNotification('Switching to Next Tab', 'rgba(108, 117, 125, 0.9)');
}

function showExitNotification() {
  showNotification('Exiting Kiosk Mode', 'rgba(220, 53, 69, 0.9)');
}

function showLockNotification() {
  showNotification('Screen Locked', 'rgba(220, 53, 69, 0.9)');
}

function showInactivityLockNotification() {
  showNotification('Auto-locked after 5 minutes', 'rgba(255, 193, 7, 0.9)', '#000');
}

function showNotification(text, backgroundColor, textColor = 'white') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 60px;
    left: 10px;
    background: ${backgroundColor};
    color: ${textColor};
    padding: 8px 16px;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    z-index: 999999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = text;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

const interactive = (el) => {
  return ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
         el.getAttribute('role') === 'button' ||
         el.onclick ||
         el.hasAttribute('onclick') ||
         el.hasAttribute('data-action') ||
         el.classList.contains('btn') ||
         el.classList.contains('button');
};

const blockKey = (e) => {
  if (unlocked || isPaused) return;

  const shouldBlock = (blocked || hoverOnlyMode) &&
                     (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32);

  if (shouldBlock && interactive(e.target)) {
    return block(e);
  }

  // Also block common navigation keys when blocked
  if (blocked && ['Tab', 'Escape', 'F5', 'F11', 'F12'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
};

// Enhanced event blocking
const blockEvents = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'auxclick',
  'contextmenu', 'submit', 'dragstart', 'selectstart'
];

const keyEvents = ['keydown', 'keyup', 'keypress'];

blockEvents.forEach(ev => {
  document.addEventListener(ev, block, true);
});

keyEvents.forEach(ev => {
  document.addEventListener(ev, blockKey, true);
});

// Track user activity
function trackActivity() {
  lastActivity = Date.now();
  // Send activity notification to background script
  chrome.runtime.sendMessage({action: 'userActivity'}).catch(() => {});
}

// Track user activity for both background script and inactivity timer
document.addEventListener('mousemove', (e) => {
  trackActivity(); // For background script
  trackUserActivity(); // For inactivity timer
});
document.addEventListener('keydown', (e) => {
  trackActivity(); // For background script
  trackUserActivity(); // For inactivity timer
});
document.addEventListener('click', (e) => {
  trackActivity(); // For background script
  trackUserActivity(); // For inactivity timer

  // Hide menu if clicking outside of menu elements
  if (menuVisible &&
      !e.target.closest('#kiosk-menu-button') &&
      !e.target.closest('#kiosk-menu-container')) {
    hideMenu();
  }
});

const keepAlive = () => {
  document.dispatchEvent(new Event('userActivity'));
  const a = document.activeElement;
  if (a?.blur) {
    a.blur();
    setTimeout(() => a.focus(), 10);
  }
};

const activity = () => {
  if (!document.hidden) {
    document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));
  }
};

const intervals = [
  setInterval(keepAlive, 60000),
  setInterval(activity, 120000)
];

function enterFullscreen() {
  try {
    const element = document.documentElement;
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
    console.log('Entered fullscreen mode');
  } catch (e) {
    console.error('Failed to enter fullscreen:', e);
  }
}

function exitFullscreen() {
  try {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    console.log('Exited fullscreen mode');
  } catch (e) {
    console.error('Failed to exit fullscreen:', e);
  }
}

// Prevent common escape sequences
document.addEventListener('keydown', (e) => {
  if (blocked && !unlocked) {
    // Block common browser shortcuts
    if ((e.ctrlKey || e.metaKey) && ['r', 'R', 'l', 'L', 't', 'T', 'w', 'W', 'n', 'N'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Alt+Tab, Alt+F4, etc.
    if (e.altKey && ['Tab', 'F4'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }
}, true);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  intervals.forEach(clearInterval);
  if (timer) clearTimeout(timer);
});

})(); // End IIFE
