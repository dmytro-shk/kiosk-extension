const state = {
  links: [],
  config: {
    kioskMode: false,
    autoStart: false,
    hoverOnlyMode: false,
    unlockPassword: ''
  },
  timers: {},
  isPaused: false,
  lastActivityTime: Date.now()
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  // Initialize elements
  ['saveBtn', 'startBtn', 'stopBtn', 'status', 'clickLockStatus', 'clickLockText',
   'addLinkBtn', 'linksContainer', 'pauseBtn', 'continueBtn',
   'kioskMode', 'autoStart', 'hoverOnlyMode', 'unlockPassword',
   'debugBtn', 'clearBtn', 'floatingTimer', 'floatingTimerTime',
   'floatingTimerLink', 'floatingTimerProgress'].forEach(id => {
    el[id] = document.getElementById(id);
  });

  // Event listeners
  el.saveBtn.addEventListener('click', save);
  el.startBtn.addEventListener('click', () => msg('start'));
  el.stopBtn.addEventListener('click', () => msg('stop'));
  el.pauseBtn.addEventListener('click', () => msg('pause'));
  el.continueBtn.addEventListener('click', () => msg('continue'));
  el.addLinkBtn.addEventListener('click', addLink);

  // Debug buttons
  if (el.debugBtn) {
    el.debugBtn.addEventListener('click', debugStorage);
  }
  if (el.clearBtn) {
    el.clearBtn.addEventListener('click', clearStorage);
  }

  // Track user activity for auto-continue
  document.addEventListener('click', updateActivity);
  document.addEventListener('keydown', updateActivity);
  document.addEventListener('mousemove', updateActivity);

  // Setup floating timer position cycling
  setupFloatingTimer();

  load();
  update();
  setInterval(update, 1000);
  setInterval(checkAutoResume, 30000); // Check every 30 seconds
});

function updateActivity() {
  state.lastActivityTime = Date.now();
}

function checkAutoResume() {
  if (state.isPaused && Date.now() - state.lastActivityTime > 180000) { // 3 minutes
    msg('continue');
  }
}

function setupFloatingTimer() {
  if (!el.floatingTimer) return;

  const positions = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
  let currentPosition = 0;

  // Load saved position
  const savedPosition = localStorage.getItem('floatingTimerPosition');
  if (savedPosition && positions.includes(savedPosition)) {
    currentPosition = positions.indexOf(savedPosition);
    el.floatingTimer.className = 'floating-timer ' + savedPosition;
  }

  // Click to cycle through positions
  el.floatingTimer.addEventListener('click', (e) => {
    e.stopPropagation();
    currentPosition = (currentPosition + 1) % positions.length;
    const newPosition = positions[currentPosition];

    // Remove all position classes
    positions.forEach(pos => el.floatingTimer.classList.remove(pos));

    // Add new position class
    el.floatingTimer.classList.add(newPosition);

    // Save position preference
    localStorage.setItem('floatingTimerPosition', newPosition);

    // Show a tooltip
    const tooltip = document.createElement('div');
    tooltip.textContent = 'Click to move';
    tooltip.style.cssText = `
      position: absolute;
      bottom: -25px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      white-space: nowrap;
      pointer-events: none;
    `;
    el.floatingTimer.appendChild(tooltip);
    setTimeout(() => tooltip.remove(), 1000);
  });
}

function load() {
  console.log('Loading config from storage...');

  chrome.storage.sync.get(['config'], (result) => {
    // Check for errors
    if (chrome.runtime.lastError) {
      console.error('Failed to load config:', chrome.runtime.lastError);
      // Initialize with defaults on error
      state.links = [
        createDefaultLink('https://example.com'),
        createDefaultLink('https://example2.com')
      ];
      renderLinks();
      return;
    }

    const config = result.config;
    console.log('Loaded config:', config);

    if (!config) {
      // Initialize with default links if none exist
      console.log('No config found, using defaults');
      state.links = [
        createDefaultLink('https://example.com'),
        createDefaultLink('https://example2.com')
      ];
      renderLinks();
      return;
    }

    // Handle migration from old config format
    if (config.url1 || config.url2) {
      console.log('Migrating from old format');
      state.links = [];
      if (config.url1) state.links.push(createDefaultLink(config.url1));
      if (config.url2) state.links.push(createDefaultLink(config.url2));
    } else if (config.links && config.links.length > 0) {
      console.log('Loading saved links:', config.links);
      // Convert any numeric IDs to strings to avoid CSS selector issues
      state.links = config.links.map(link => ({
        ...link,
        id: typeof link.id === 'number' ? `link_${link.id}` : link.id
      }));
    } else {
      // No links found, use defaults
      console.log('No links in config, using defaults');
      state.links = [
        createDefaultLink('https://example.com'),
        createDefaultLink('https://example2.com')
      ];
    }

    // Load global settings
    state.config = {
      kioskMode: config.kioskMode || false,
      autoStart: config.autoStart || false,
      hoverOnlyMode: config.hoverOnlyMode || false,
      unlockPassword: config.unlockPassword || ''
    };

    console.log('Final state after load:', state);
    loadGlobalSettings();
    renderLinks();
  });
}

function createDefaultLink(url) {
  return {
    id: Date.now() + '_' + Math.floor(Math.random() * 10000),
    url: url,
    switchInterval: 30,
    refreshBeforeSwitch: 5,
    refreshEnabled: true,
    blockClicksAfter: 120
  };
}

function loadGlobalSettings() {
  el.kioskMode.checked = state.config.kioskMode;
  el.autoStart.checked = state.config.autoStart;
  el.hoverOnlyMode.checked = state.config.hoverOnlyMode;
  el.unlockPassword.value = state.config.unlockPassword;
}

function addLink() {
  const newLink = createDefaultLink('https://');
  state.links.push(newLink);
  renderLinks();

  // Focus on the new link's URL input
  setTimeout(() => {
    const newInput = document.querySelector(`#link-${newLink.id} .link-url input`);
    if (newInput) newInput.focus();
  }, 100);
}

function removeLink(linkId) {
  if (state.links.length <= 1) {
    alert('You must have at least one link configured.');
    return;
  }
  // Link IDs are strings now
  state.links = state.links.filter(link => link.id !== linkId);
  renderLinks();
}

function renderLinks() {
  el.linksContainer.innerHTML = '';

  if (state.links.length === 0) {
    addLink();
    return;
  }

  state.links.forEach((link, index) => {
    const linkEl = createLinkElement(link, index);
    el.linksContainer.appendChild(linkEl);
  });
}

function createLinkElement(link, index) {
  const div = document.createElement('div');
  div.className = 'link-item';
  div.id = `link-${link.id}`;
  div.dataset.linkId = link.id;

  div.innerHTML = `
    <div class="link-header">
      <span class="link-number">Link ${index + 1}</span>
      <div class="link-controls">
        <button class="btn-danger btn-small link-remove" data-link-id="${link.id}">Remove</button>
      </div>
    </div>

    <div class="link-url">
      <label>Website URL:</label>
      <input type="text" class="link-url-input" value="${link.url}" placeholder="https://example.com"
             data-link-id="${link.id}" data-field="url">
    </div>

    <div class="link-settings">
      <div>
        <label>Switch Interval (sec):</label>
        <input type="number" class="link-number-input" value="${link.switchInterval}" min="10" max="3600"
               data-link-id="${link.id}" data-field="switchInterval">
      </div>
      <div>
        <label>Refresh Before (sec):</label>
        <input type="number" class="link-number-input" value="${link.refreshBeforeSwitch}" min="0" max="60"
               data-link-id="${link.id}" data-field="refreshBeforeSwitch"
               ${!link.refreshEnabled ? 'disabled' : ''}>
      </div>
      <div>
        <label>
          <input type="checkbox" class="link-checkbox-input" ${link.refreshEnabled ? 'checked' : ''}
                 data-link-id="${link.id}" data-field="refreshEnabled">
          Enable Refresh
        </label>
      </div>
      <div>
        <label>Block Clicks After (sec):</label>
        <input type="number" class="link-number-input" value="${link.blockClicksAfter}" min="0" max="3600"
               data-link-id="${link.id}" data-field="blockClicksAfter">
      </div>
    </div>

    <div class="link-timers">
      <div class="timer-display" id="timer-${link.id}">Ready</div>
      <div class="progress-bar">
        <div class="progress-fill" id="progress-${link.id}" style="width: 0%"></div>
      </div>
    </div>
  `;

  // Add event listeners after creating the element
  setupLinkEventListeners(div, link.id);

  return div;
}

function setupLinkEventListeners(element, linkId) {
  // Link IDs are strings now, no conversion needed

  // Remove button
  const removeBtn = element.querySelector('.link-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => removeLink(linkId));
  }

  // URL input
  const urlInput = element.querySelector('.link-url-input');
  if (urlInput) {
    urlInput.addEventListener('change', (e) => updateLinkField(linkId, 'url', e.target.value));
  }

  // Number inputs
  element.querySelectorAll('.link-number-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const field = e.target.dataset.field;
      const value = parseInt(e.target.value);
      updateLinkField(linkId, field, value);
    });
  });

  // Checkbox inputs
  element.querySelectorAll('.link-checkbox-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const field = e.target.dataset.field;
      const value = e.target.checked;
      updateLinkField(linkId, field, value);
    });
  });
}

function updateLinkField(linkId, field, value) {
  // Link IDs are strings now
  const link = state.links.find(l => l.id === linkId);
  if (link) {
    link[field] = value;

    // Special handling for refresh enabled/disabled
    if (field === 'refreshEnabled') {
      // Use data attribute selector instead of ID selector to avoid CSS selector issues
      const linkElement = document.querySelector(`[data-link-id="${linkId}"]`);
      if (linkElement) {
        const refreshInput = linkElement.querySelector('input[data-field="refreshBeforeSwitch"]');
        if (refreshInput) refreshInput.disabled = !value;
      }
    }

    // Validation
    if (field === 'refreshBeforeSwitch' && link.refreshEnabled && value >= link.switchInterval) {
      alert('Refresh time must be less than switch interval');
      const linkElement = document.querySelector(`[data-link-id="${linkId}"]`);
      if (linkElement) {
        const refreshInput = linkElement.querySelector('input[data-field="refreshBeforeSwitch"]');
        if (refreshInput) {
          refreshInput.value = link.switchInterval - 1;
        }
      }
      link.refreshBeforeSwitch = link.switchInterval - 1;
    }
  }
}


function save() {
  // Validate all links
  if (state.links.length === 0) {
    alert('Please add at least one link before saving.');
    return;
  }

  for (const link of state.links) {
    if (!valid(link.url)) {
      alert(`Invalid URL in Link ${state.links.indexOf(link) + 1}`);
      return;
    }
    if (link.refreshEnabled && link.refreshBeforeSwitch >= link.switchInterval) {
      alert(`Refresh time must be less than switch interval in Link ${state.links.indexOf(link) + 1}`);
      return;
    }
  }

  // Save global settings
  state.config.kioskMode = el.kioskMode.checked;
  state.config.autoStart = el.autoStart.checked;
  state.config.hoverOnlyMode = el.hoverOnlyMode.checked;
  state.config.unlockPassword = el.unlockPassword.value.trim();

  const configToSave = {
    links: state.links,
    ...state.config
  };

  console.log('Saving config:', configToSave);

  chrome.storage.sync.set({config: configToSave}, () => {
    // Check for errors
    if (chrome.runtime.lastError) {
      console.error('Failed to save:', chrome.runtime.lastError);
      alert('Failed to save settings: ' + chrome.runtime.lastError.message);
      return;
    }

    console.log('Config saved successfully');

    const orig = el.saveBtn.textContent;
    const col = el.saveBtn.style.backgroundColor;
    el.saveBtn.textContent = 'Saved!';
    el.saveBtn.style.backgroundColor = '#4CAF50';
    setTimeout(() => {
      el.saveBtn.textContent = orig;
      el.saveBtn.style.backgroundColor = col;
    }, 2000);

    // Verify the save by reading it back
    chrome.storage.sync.get(['config'], (result) => {
      console.log('Verification - saved config:', result.config);
    });
  });
}

function msg(action, data = null) {
  const message = data ? {action, data} : {action};
  chrome.runtime.sendMessage(message, update);
}

function update() {
  chrome.runtime.sendMessage({action: 'getStatus'}, (r) => {
    if (!r) return;

    // Update main status
    if (r.isRunning) {
      if (r.isPaused) {
        el.status.className = 'status paused';
        el.status.innerHTML = `Status: <strong>Paused</strong> | Tab: ${r.currentTabIndex + 1} | ${r.elapsedTime}s`;
      } else {
        el.status.className = 'status running';
        el.status.innerHTML = `Status: <strong>Running</strong> | Tab: ${r.currentTabIndex + 1} | ${r.elapsedTime}s`;
      }
      el.startBtn.disabled = true;
      el.stopBtn.disabled = false;
      el.pauseBtn.disabled = false;
      el.continueBtn.disabled = false;

      // Update click lock status
      el.clickLockStatus.style.display = 'block';
      if (r.links && r.links[r.currentTabIndex]) {
        const currentLink = r.links[r.currentTabIndex];
        const left = currentLink.blockClicksAfter - r.elapsedTime;
        if (left > 0) {
          el.clickLockStatus.className = 'status unlocked';
          el.clickLockText.textContent = `Unlocked (${left}s)`;
        } else {
          el.clickLockStatus.className = 'status locked';
          el.clickLockText.textContent = 'LOCKED';
        }
      }
    } else {
      el.status.className = 'status stopped';
      el.status.innerHTML = 'Status: <strong>Stopped</strong>';
      el.startBtn.disabled = false;
      el.stopBtn.disabled = true;
      el.pauseBtn.disabled = true;
      el.continueBtn.disabled = true;
      el.clickLockStatus.style.display = 'none';

      // Hide floating timer when stopped
      el.floatingTimer.classList.remove('active');
    }

    // Update individual link timers
    updateLinkTimers(r);

    state.isPaused = r.isPaused || false;
  });
}

function updateLinkTimers(status) {
  if (!status.isRunning || !status.linkTimers) return;

  // Update floating timer for current active link
  if (status.currentTabIndex >= 0 && status.linkTimers[status.currentTabIndex]) {
    const currentTimer = status.linkTimers[status.currentTabIndex];
    const currentLink = state.links[status.currentTabIndex];

    // Show floating timer
    el.floatingTimer.classList.add('active');

    // Format time as MM:SS
    const minutes = Math.floor(currentTimer.remaining / 60);
    const seconds = currentTimer.remaining % 60;
    el.floatingTimerTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Show current link info
    if (currentLink) {
      try {
        const url = new URL(currentLink.url);
        el.floatingTimerLink.textContent = `Link ${status.currentTabIndex + 1}: ${url.hostname}`;
      } catch (e) {
        el.floatingTimerLink.textContent = `Link ${status.currentTabIndex + 1}`;
      }
    }

    // Update progress
    const progress = ((currentTimer.total - currentTimer.remaining) / currentTimer.total) * 100;
    el.floatingTimerProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;

    // Update paused state
    if (status.isPaused) {
      el.floatingTimer.classList.add('paused');
    } else {
      el.floatingTimer.classList.remove('paused');
    }
  }

  status.linkTimers.forEach((timer, index) => {
    const timerEl = document.getElementById(`timer-${state.links[index]?.id}`);
    const progressEl = document.getElementById(`progress-${state.links[index]?.id}`);
    const linkEl = document.getElementById(`link-${state.links[index]?.id}`);

    if (!timerEl || !progressEl || !linkEl) return;

    // Update active state
    if (index === status.currentTabIndex) {
      linkEl.classList.add('active');
    } else {
      linkEl.classList.remove('active');
    }

    // Update timer display
    if (status.isPaused) {
      timerEl.textContent = `Paused (${timer.remaining}s)`;
      timerEl.classList.add('paused');
      progressEl.classList.add('paused');
    } else {
      timerEl.textContent = `${timer.remaining}s remaining`;
      timerEl.classList.remove('paused');
      progressEl.classList.remove('paused');
    }

    // Update progress bar
    const progress = ((timer.total - timer.remaining) / timer.total) * 100;
    progressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  });
}

function valid(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Debug functions
function debugStorage() {
  console.log('=== Storage Debug ===');
  console.log('Current state:', state);

  chrome.storage.sync.get(null, (items) => {
    if (chrome.runtime.lastError) {
      console.error('Error reading storage:', chrome.runtime.lastError);
      alert('Storage error: ' + chrome.runtime.lastError.message);
    } else {
      console.log('All storage items:', items);
      alert('Check console for storage debug info');
    }
  });

  // Check storage quota
  chrome.storage.sync.getBytesInUse(null, (bytesInUse) => {
    console.log('Storage bytes in use:', bytesInUse);
    console.log('Storage quota:', chrome.storage.sync.QUOTA_BYTES);
    console.log('Percentage used:', (bytesInUse / chrome.storage.sync.QUOTA_BYTES * 100).toFixed(2) + '%');
  });
}

function clearStorage() {
  if (confirm('Are you sure you want to clear all saved settings?')) {
    chrome.storage.sync.clear(() => {
      if (chrome.runtime.lastError) {
        console.error('Failed to clear storage:', chrome.runtime.lastError);
        alert('Failed to clear storage: ' + chrome.runtime.lastError.message);
      } else {
        console.log('Storage cleared');
        alert('Storage cleared! Reloading...');
        location.reload();
      }
    });
  }
}

// Functions are now accessed via event listeners, not global window object
