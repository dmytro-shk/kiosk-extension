let blocked = false;
let start = null;
let after = 120000;
let timer = null;
let hoverOnlyMode = false;
let unlockPassword = '';
let clickCount = 0;
let unlocked = false;
let lastActivity = Date.now();

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'updateClickBlock') {
    start = req.startTime;
    after = req.blockAfter;
    hoverOnlyMode = req.hoverOnlyMode || false;
    unlockPassword = req.unlockPassword || '';
    unlocked = false; // Reset unlock status on new session
    clickCount = 0;
    schedule();
  } else if (req.action === 'enterFullscreen') {
    enterFullscreen();
  } else if (req.action === 'exitFullscreen') {
    exitFullscreen();
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
  if (unlocked) return;

  const shouldBlock = blocked || (hoverOnlyMode && !isHoverEvent(e.type));

  if (shouldBlock) {
    // Handle unlock sequence
    if (e.type === 'click') {
      clickCount++;

      if (clickCount === 6 && unlockPassword) {
        setTimeout(() => {
          const password = prompt('Enter password to unlock restrictions:');
          if (password === unlockPassword) {
            unlocked = true;
            console.log('Restrictions unlocked by user');
            hideBlockNotification();
            showUnlockNotification();
            return;
          } else {
            console.log('Incorrect password entered');
            showIncorrectPasswordNotification();
          }
        }, 10);
      }

      if (clickCount > 6) clickCount = 1;

      // Visual feedback for blocked clicks
      showClickBlockedFeedback(e.clientX, e.clientY);
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
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 128, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 999999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = 'Restrictions Unlocked';

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 2000);
}

function showIncorrectPasswordNotification() {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(255, 128, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 999999;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.3s ease;
  `;
  notification.textContent = 'Incorrect Password';

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 2000);
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
  if (unlocked) return;

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

document.addEventListener('mousemove', trackActivity);
document.addEventListener('keydown', trackActivity);
document.addEventListener('click', trackActivity);

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
