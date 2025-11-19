const state = {
  links: [],
  config: {
    kioskMode: false,
    autoStart: false,
    unlockPassword: ''
  },
  timers: {},
  isPaused: false,
  lastActivityTime: Date.now()
};

const el = {};
let isUILocked = false;
let savedPassword = '';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize elements
  ['saveBtn', 'startBtn', 'stopBtn', 'status', 'addLinkBtn', 'linksContainer',
   'kioskMode', 'autoStart', 'unlockPassword', 'lockScreen', 'lockPassword',
   'unlockBtn', 'lockError', 'togglePassword', 'eyeIcon', 'toggleSettingsPassword',
   'settingsEyeIcon'].forEach(id => {
    el[id] = document.getElementById(id);
  });

  // Lock screen event listeners
  el.unlockBtn.addEventListener('click', attemptUnlock);
  el.lockPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') attemptUnlock();
  });
  el.togglePassword.addEventListener('click', togglePasswordVisibility);
  el.toggleSettingsPassword.addEventListener('click', toggleSettingsPasswordVisibility);

  // Event listeners
  el.saveBtn.addEventListener('click', save);
  el.startBtn.addEventListener('click', () => {
    msg('start');
    // Removed UI locking - settings can be changed while kiosk is running
    // Password is still used for content script unlocking (5-click sequence)
  });
  el.stopBtn.addEventListener('click', () => msg('stop'));
  el.addLinkBtn.addEventListener('click', addLink);


  // Track user activity for auto-continue
  document.addEventListener('click', updateActivity);
  document.addEventListener('keydown', updateActivity);
  document.addEventListener('mousemove', updateActivity);

  load();
  // Don't check lock status on initial load - only lock after starting
  update();
  setInterval(update, 1000);
  // Auto-resume disabled to prevent unwanted resumes
  // setInterval(checkAutoResume, 30000); // Check every 30 seconds
});

function showLockScreen() {
  el.lockScreen.style.display = 'flex';
  el.lockPassword.value = '';
  el.lockError.style.display = 'none';
  el.lockPassword.focus();
}

function hideLockScreen() {
  el.lockScreen.style.display = 'none';
  isUILocked = false;
}

function attemptUnlock() {
  const enteredPassword = el.lockPassword.value;

  if (enteredPassword === savedPassword) {
    hideLockScreen();
    update(); // Update UI after unlocking
  } else {
    el.lockError.textContent = 'Incorrect password';
    el.lockError.style.display = 'block';
    el.lockPassword.value = '';
    el.lockPassword.focus();

    // Hide error after 3 seconds
    setTimeout(() => {
      el.lockError.style.display = 'none';
    }, 3000);
  }
}

function togglePasswordVisibility() {
  const passwordInput = el.lockPassword;
  const icon = el.eyeIcon;

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.textContent = '🙈';
    el.togglePassword.title = 'Hide password';
  } else {
    passwordInput.type = 'password';
    icon.textContent = '👁️';
    el.togglePassword.title = 'Show password';
  }
}

function toggleSettingsPasswordVisibility() {
  const passwordInput = el.unlockPassword;
  const icon = el.settingsEyeIcon;

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.textContent = '🙈';
    el.toggleSettingsPassword.title = 'Hide password';
  } else {
    passwordInput.type = 'password';
    icon.textContent = '👁️';
    el.toggleSettingsPassword.title = 'Show password';
  }
}

function updateActivity() {
  state.lastActivityTime = Date.now();
}

// Auto-resume function (disabled to prevent unwanted resumes)
/*
function checkAutoResume() {
  if (state.isPaused && Date.now() - state.lastActivityTime > 180000) { // 3 minutes
    msg('continue');
  }
}
*/


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
    blockClicksAfter: 120,
    allowClicks: false
  };
}

function loadGlobalSettings() {
  el.kioskMode.checked = state.config.kioskMode;
  el.autoStart.checked = state.config.autoStart;
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
      <div>
        <label style="color: #4CAF50; font-weight: 600;">
          <input type="checkbox" class="link-checkbox-input" ${link.allowClicks ? 'checked' : ''}
                 data-link-id="${link.id}" data-field="allowClicks">
          ✓ Allow Clicks
        </label>
        <div class="help-text" style="margin-left: 20px; margin-top: 2px;">Override blocking for this link</div>
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
  // Don't update if UI is locked
  if (isUILocked) return;

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

      // Show unlock status in main status
      if (r.links && r.links[r.currentTabIndex]) {
        const currentLink = r.links[r.currentTabIndex];
        const left = currentLink.blockClicksAfter - r.elapsedTime;
        if (left > 0) {
          el.status.innerHTML += ' | <span style="color: #4CAF50;">Unlocked</span>';
        } else {
          el.status.innerHTML += ' | <span style="color: #f44336;">Locked</span>';
        }
      }
    } else {
      el.status.className = 'status stopped';
      el.status.innerHTML = 'Status: <strong>Stopped</strong>';
      el.startBtn.disabled = false;
      el.stopBtn.disabled = true;
    }

    // Update active link highlighting
    updateActiveLinkHighlight(r);

    state.isPaused = r.isPaused || false;
  });
}

function updateActiveLinkHighlight(status) {
  if (!status.isRunning || !status.linkTimers) return;

  // Update active link highlighting only
  state.links.forEach((link, index) => {
    const linkEl = document.getElementById(`link-${link.id}`);
    if (!linkEl) return;

    if (index === status.currentTabIndex) {
      linkEl.classList.add('active');
    } else {
      linkEl.classList.remove('active');
    }
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


// Functions are now accessed via event listeners, not global window object
