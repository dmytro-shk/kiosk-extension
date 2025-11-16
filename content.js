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
let pauseButton = null;
let nextTabButton = null;
let lockButton = null;
let settingsButton = null;
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
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
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
    // Only create buttons/timer if they don't exist
    if (!pauseButton) {
      createControlButtons();
    } else {
      updateButtonVisibility();
    }
    if (!timerDisplay) {
      createTimerDisplay();
    } else {
      updateTimerDisplay();
    }
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
    // Don't create new buttons/timer if they already exist
    if (!pauseButton) {
      createControlButtons();
    }
    if (!timerDisplay) {
      createTimerDisplay();
    }
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
    if (e.target.id === 'kiosk-pause-button' ||
        e.target.id === 'kiosk-next-button' ||
        e.target.id === 'kiosk-lock-button' ||
        e.target.id === 'kiosk-settings-button') {
      return;
    }

    // Check if target has closest method (only elements have this method)
    if (typeof e.target.closest === 'function') {
      if (e.target.closest('#kiosk-pause-button') ||
          e.target.closest('#kiosk-next-button') ||
          e.target.closest('#kiosk-lock-button') ||
          e.target.closest('#kiosk-settings-button')) {
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
  // Check if buttons already exist in DOM
  const existingPause = document.getElementById('kiosk-pause-button');
  const existingNext = document.getElementById('kiosk-next-button');
  const existingLock = document.getElementById('kiosk-lock-button');
  const existingSettings = document.getElementById('kiosk-settings-button');

  // If any button exists, just update references and visibility
  if (existingPause || existingNext || existingLock || existingSettings) {
    pauseButton = existingPause;
    nextTabButton = existingNext;
    lockButton = existingLock;
    settingsButton = existingSettings;
    updateButtonVisibility();
    return;
  }

  // Always clean up existing buttons first
  removeControlButtons();

  if (!start) return;

  // Create pause button (always visible)
  pauseButton = document.createElement('div');
  pauseButton.id = 'kiosk-pause-button';
  pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
  pauseButton.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: ${isPaused ? 'linear-gradient(135deg, #28a745 0%, #20c997 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    min-width: 80px;
    text-align: center;
    pointer-events: auto;
  `;
  pauseButton.onclick = togglePause; // Use onclick instead of addEventListener to avoid duplicates
  document.body.appendChild(pauseButton);

  // Create next tab button (always visible)
  nextTabButton = document.createElement('div');
  nextTabButton.id = 'kiosk-next-button';
  nextTabButton.textContent = 'Next Tab';
  nextTabButton.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 100px;
    background: linear-gradient(135deg, #6c757d 0%, #495057 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    min-width: 80px;
    text-align: center;
    pointer-events: auto;
  `;
  nextTabButton.onclick = switchToNextTab; // Use onclick instead of addEventListener to avoid duplicates
  document.body.appendChild(nextTabButton);

  // Create lock button (only visible when unlocked)
  lockButton = document.createElement('div');
  lockButton.id = 'kiosk-lock-button';
  lockButton.textContent = 'Lock';
  lockButton.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 190px;
    background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    min-width: 80px;
    text-align: center;
    pointer-events: auto;
    display: ${unlocked ? 'block' : 'none'};
  `;
  lockButton.onclick = performLock; // Use onclick instead of addEventListener to avoid duplicates
  document.body.appendChild(lockButton);

  // Create exit button (only visible when unlocked)
  settingsButton = document.createElement('div');
  settingsButton.id = 'kiosk-settings-button';
  settingsButton.textContent = 'Exit';
  settingsButton.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 280px;
    background: linear-gradient(135deg, #17a2b8 0%, #138496 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    min-width: 80px;
    text-align: center;
    pointer-events: auto;
    display: ${unlocked ? 'block' : 'none'};
  `;
  settingsButton.onclick = exitKiosk; // Use onclick instead of addEventListener to avoid duplicates
  document.body.appendChild(settingsButton);

  updateButtonVisibility();
}

function removeControlButtons() {
  if (pauseButton && pauseButton.parentNode) {
    pauseButton.parentNode.removeChild(pauseButton);
    pauseButton = null;
  }
  if (nextTabButton && nextTabButton.parentNode) {
    nextTabButton.parentNode.removeChild(nextTabButton);
    nextTabButton = null;
  }
  if (lockButton && lockButton.parentNode) {
    lockButton.parentNode.removeChild(lockButton);
    lockButton = null;
  }
  if (settingsButton && settingsButton.parentNode) {
    settingsButton.parentNode.removeChild(settingsButton);
    settingsButton = null;
  }
}

function updateButtonVisibility() {
  if (pauseButton) {
    pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
    pauseButton.style.background = isPaused ?
      'linear-gradient(135deg, #28a745 0%, #20c997 100%)' :
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  }

  if (lockButton) {
    lockButton.style.display = unlocked ? 'block' : 'none';
  }

  if (settingsButton) {
    settingsButton.style.display = unlocked ? 'block' : 'none';
  }
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
  // Check if timer already exists in DOM
  const existingTimer = document.getElementById('kiosk-timer-display');
  if (existingTimer) {
    timerDisplay = existingTimer;
    updateTimerDisplay();
    return;
  }

  // Always remove existing timer first to prevent duplicates
  removeTimerDisplay();

  // Only create timer if we have an active kiosk session
  if (!start || !currentTabTimer) return;

  timerDisplay = document.createElement('div');
  timerDisplay.id = 'kiosk-timer-display';
  timerDisplay.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 600;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    user-select: none;
    min-width: 140px;
    text-align: center;
    pointer-events: none;
  `;

  // Create timer content
  timerDisplay.innerHTML = `
    <div style="font-size: 12px; opacity: 0.9; margin-bottom: 4px;">NEXT SWITCH</div>
    <div id="timer-time" style="font-size: 24px; font-weight: bold; line-height: 1;"></div>
    <div style="width: 100%; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px; margin-top: 8px; overflow: hidden;">
      <div id="timer-progress" style="height: 100%; background: white; transition: width 0.3s ease; width: 0%;"></div>
    </div>
  `;

  document.body.appendChild(timerDisplay);
  updateTimerDisplay();
}

function removeTimerDisplay() {
  if (timerDisplay && timerDisplay.parentNode) {
    timerDisplay.parentNode.removeChild(timerDisplay);
    timerDisplay = null;
  }
}

function updateTimerDisplay() {
  if (!timerDisplay || !currentTabTimer) return;

  const timeEl = document.getElementById('timer-time');
  const progressEl = document.getElementById('timer-progress');

  if (!timeEl || !progressEl) return;

  // Format time as MM:SS
  const minutes = Math.floor(currentTabTimer.remaining / 60);
  const seconds = currentTabTimer.remaining % 60;
  timeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Update progress
  const progress = ((currentTabTimer.total - currentTabTimer.remaining) / currentTabTimer.total) * 100;
  progressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;

  // Update paused state
  if (isPaused || currentTabTimer.paused) {
    timerDisplay.style.background = 'linear-gradient(135deg, #ffc107 0%, #ff9800 100%)';
    timeEl.parentElement.querySelector('div').textContent = 'PAUSED';
  } else {
    timerDisplay.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    timeEl.parentElement.querySelector('div').textContent = 'NEXT SWITCH';
  }
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
