const state = {
  config: {
    links: [],
    kioskMode: false,
    autoStart: false,
    hoverOnlyMode: false,
    unlockPassword: ''
  },
  isRunning: false,
  isPaused: false,
  currentTabIndex: 0,
  tabs: [],
  startTime: null,
  pauseTime: null,
  linkTimers: [],
  timers: {},
  lastActivityTime: Date.now()
};

// Load configuration on startup
function loadConfig() {
  console.log('[Background] Loading config from storage...');
  try {
    chrome.storage.sync.get(['config'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Storage error:', chrome.runtime.lastError);
        return;
      }

      const config = result.config;
      console.log('[Background] Loaded config:', config);

      if (config) {
        // Handle migration from old format
        if (config.url1 || config.url2) {
          console.log('[Background] Migrating from old format');
          const links = [];
          if (config.url1) links.push({
            id: 'link_1',
            url: config.url1,
            switchInterval: config.switchInterval || 30,
            refreshBeforeSwitch: config.refreshBeforeSwitch || 5,
            refreshEnabled: true,
            blockClicksAfter: config.blockClicksAfter || 120
          });
          if (config.url2) links.push({
            id: 'link_2',
            url: config.url2,
            switchInterval: config.switchInterval || 30,
            refreshBeforeSwitch: config.refreshBeforeSwitch || 5,
            refreshEnabled: true,
            blockClicksAfter: config.blockClicksAfter || 120
          });

          state.config = {
            links,
            kioskMode: config.kioskMode || false,
            autoStart: config.autoStart || false,
            hoverOnlyMode: config.hoverOnlyMode || false,
            unlockPassword: config.unlockPassword || ''
          };

          console.log('[Background] Saving migrated config');
          chrome.storage.sync.set({config: state.config}, () => {
            if (chrome.runtime.lastError) {
              console.error('[Background] Failed to save migrated config:', chrome.runtime.lastError);
            } else {
              console.log('[Background] Migrated config saved');
            }
          });
        } else {
          Object.assign(state.config, config);
          console.log('[Background] Config loaded successfully:', state.config);
        }
      } else {
        console.log('[Background] No config found in storage');
      }
    });
  } catch (error) {
    console.error('[Background] Failed to load config:', error);
  }
}

loadConfig();

chrome.storage.onChanged.addListener((changes, namespace) => {
  try {
    if (namespace === 'sync' && changes.config) {
      console.log('[Background] Storage changed:', changes.config);

      if (changes.config.newValue) {
        Object.assign(state.config, changes.config.newValue);
        console.log('[Background] Updated config:', state.config);

        if (state.isRunning) {
          console.log('[Background] Restarting kiosk mode with new config');
          stopKioskMode();
          setTimeout(startKioskMode, 1000);
        }
      }
    }
  } catch (error) {
    console.error('[Background] Storage change handler error:', error);
  }
});

chrome.runtime.onMessage.addListener((req, sender, respond) => {
  try {
    const actions = {
      start: () => {
        startKioskMode();
        return {status: 'started'};
      },
      stop: () => {
        stopKioskMode();
        return {status: 'stopped'};
      },
      pause: () => {
        pauseAllTimers();
        return {status: 'paused'};
      },
      continue: () => {
        resumeAllTimers();
        return {status: 'resumed'};
      },
      pauseLink: (linkId) => {
        pauseLinkTimer(linkId);
        return {status: 'link paused'};
      },
      continueLink: (linkId) => {
        resumeLinkTimer(linkId);
        return {status: 'link resumed'};
      },
      getStatus: () => ({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        config: state.config,
        links: state.config.links,
        currentTabIndex: state.currentTabIndex,
        elapsedTime: state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0,
        linkTimers: state.linkTimers
      }),
      userActivity: () => {
        state.lastActivityTime = Date.now();
        return {status: 'activity recorded'};
      }
    };

    const action = req.data ? actions[req.action]?.(req.data) : actions[req.action]?.();
    if (action) respond(action);
    return true;
  } catch (error) {
    console.error('Message handler error:', error);
    respond({error: error.message});
    return true;
  }
});

const autoStart = () => {
  chrome.storage.sync.get(['config'], ({config}) => {
    if (config?.autoStart) {
      setTimeout(startKioskMode, 2000);
    }
  });
};

chrome.runtime.onStartup.addListener(autoStart);
chrome.runtime.onInstalled.addListener(autoStart);

async function startKioskMode() {
  if (state.isRunning) return;

  if (!state.config.links || state.config.links.length === 0) {
    console.error('No links configured');
    return;
  }

  state.isRunning = true;
  state.isPaused = false;
  state.startTime = Date.now();
  state.currentTabIndex = 0;

  initializeLinkTimers();

  try {
    const urls = state.config.links.map(link => link.url);
    const win = await chrome.windows.create({
      url: urls,
      focused: true,
      state: state.config.kioskMode ? 'fullscreen' : 'maximized'
    });

    state.tabs = win.tabs;
    await new Promise(r => setTimeout(r, 2000));
    await chrome.tabs.update(state.tabs[0].id, {active: true});

    broadcast();
    scheduleCurrentLink();
  } catch (e) {
    console.error('Start failed:', e);
    stopKioskMode();
  }
}

function stopKioskMode() {
  state.isRunning = false;
  state.isPaused = false;
  state.startTime = null;
  state.pauseTime = null;

  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};
  state.linkTimers = [];

  state.tabs.forEach(t => chrome.tabs.remove(t.id).catch(() => {}));
  state.tabs = [];
}

function initializeLinkTimers() {
  state.linkTimers = state.config.links.map((link, index) => ({
    linkId: link.id,
    total: link.switchInterval,
    remaining: link.switchInterval,
    paused: false,
    startTime: Date.now()
  }));
}

function pauseAllTimers() {
  if (!state.isRunning) return;

  state.isPaused = true;
  state.pauseTime = Date.now();

  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};

  state.linkTimers.forEach(timer => {
    if (!timer.paused) {
      timer.paused = true;
    }
  });
}

function resumeAllTimers() {
  if (!state.isRunning || !state.isPaused) return;

  state.isPaused = false;
  const pauseDuration = Date.now() - state.pauseTime;
  state.startTime += pauseDuration;

  state.linkTimers.forEach(timer => {
    timer.paused = false;
    timer.startTime = Date.now();
  });

  scheduleCurrentLink();
  broadcast();
}

function pauseLinkTimer(linkId) {
  const timer = state.linkTimers.find(t => t.linkId === linkId);
  if (timer && !timer.paused) {
    timer.paused = true;

    if (state.config.links[state.currentTabIndex]?.id === linkId) {
      Object.values(state.timers).forEach(t => t && clearTimeout(t));
      state.timers = {};
    }
  }
}

function resumeLinkTimer(linkId) {
  const timer = state.linkTimers.find(t => t.linkId === linkId);
  if (timer && timer.paused) {
    timer.paused = false;
    timer.startTime = Date.now();

    if (state.config.links[state.currentTabIndex]?.id === linkId) {
      scheduleCurrentLink();
    }
  }
}

function scheduleCurrentLink() {
  if (!state.isRunning || state.isPaused) return;

  const currentLink = state.config.links[state.currentTabIndex];
  const currentTimer = state.linkTimers[state.currentTabIndex];

  if (!currentLink || !currentTimer || currentTimer.paused) return;

  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};

  const remainingTime = currentTimer.remaining * 1000;
  const refreshTime = currentLink.refreshEnabled ?
    Math.max(0, remainingTime - (currentLink.refreshBeforeSwitch * 1000)) : -1;

  if (refreshTime > 0 && refreshTime < remainingTime) {
    state.timers.refresh = setTimeout(() => refresh(), refreshTime);
  }

  state.timers.switch = setTimeout(() => switchTab(), remainingTime);
  currentTimer.startTime = Date.now();
}

async function refresh() {
  if (!state.isRunning || state.isPaused || !state.tabs.length) return;

  const nextIndex = (state.currentTabIndex + 1) % state.tabs.length;
  try {
    // Verify tab exists before refreshing
    const tabExists = await validateTab(state.tabs[nextIndex].id);
    if (!tabExists) {
      console.log('Tab to refresh no longer exists, skipping refresh');
      return;
    }

    await chrome.tabs.reload(state.tabs[nextIndex].id);
    console.log(`Refreshed tab ${nextIndex + 1}`);
  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

async function validateTab(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

async function validateAllTabs() {
  const validTabs = [];
  for (const tab of state.tabs) {
    const exists = await validateTab(tab.id);
    if (exists) {
      validTabs.push(tab);
    }
  }
  return validTabs;
}

async function recreateTabs() {
  console.log('[Background] Recreating tabs due to invalid tab IDs');

  // First, check which tabs are still valid
  const validTabs = await validateAllTabs();

  if (validTabs.length === state.config.links.length) {
    // All tabs are valid, update state
    state.tabs = validTabs;
    console.log('[Background] All tabs are still valid');
    scheduleCurrentLink();
    return;
  }

  // Some or all tabs are invalid, recreate the window
  console.log('[Background] Some tabs are invalid, recreating window');

  // Close any remaining valid tabs
  for (const tab of validTabs) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // Tab might already be closed
    }
  }

  // Create new window with all tabs
  const urls = state.config.links.map(link => link.url);
  try {
    const win = await chrome.windows.create({
      url: urls,
      focused: true,
      state: state.config.kioskMode ? 'fullscreen' : 'maximized'
    });

    state.tabs = win.tabs;
    await new Promise(r => setTimeout(r, 2000));

    // Make sure we're on the current tab index
    if (state.tabs[state.currentTabIndex]) {
      await chrome.tabs.update(state.tabs[state.currentTabIndex].id, {active: true});
    }

    console.log('[Background] Tabs recreated successfully');
    broadcast();
    scheduleCurrentLink();
  } catch (e) {
    console.error('[Background] Failed to recreate tabs:', e);
    throw e;
  }
}

async function switchTab() {
  if (!state.isRunning || state.isPaused || !state.tabs.length) return;

  const currentTimer = state.linkTimers[state.currentTabIndex];
  if (currentTimer) {
    currentTimer.remaining = currentTimer.total;
  }

  state.currentTabIndex = (state.currentTabIndex + 1) % state.tabs.length;

  try {
    // First, verify the tab still exists
    const tabExists = await validateTab(state.tabs[state.currentTabIndex].id);

    if (!tabExists) {
      console.log('Tab no longer exists, attempting to recreate tabs');
      await recreateTabs();
      return; // recreateTabs will handle scheduling
    }

    await chrome.tabs.update(state.tabs[state.currentTabIndex].id, {active: true});
    console.log(`Switched to tab ${state.currentTabIndex + 1}`);

    broadcast();
    scheduleCurrentLink();
  } catch (e) {
    console.error('Switch failed:', e);
    // Try to recover by recreating tabs
    try {
      await recreateTabs();
    } catch (recoveryError) {
      console.error('Recovery failed:', recoveryError);
      stopKioskMode();
    }
  }
}

async function broadcast() {
  if (!state.startTime) return;

  const currentLink = state.config.links[state.currentTabIndex];
  if (!currentLink) return;

  const msg = {
    action: 'updateClickBlock',
    startTime: state.startTime,
    blockAfter: currentLink.blockClicksAfter * 1000,
    hoverOnlyMode: state.config.hoverOnlyMode,
    unlockPassword: state.config.unlockPassword
  };

  // Send message to each tab, ignoring failures for closed tabs
  for (const tab of state.tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      // Tab might be closed or not ready for messages
      console.log(`Failed to send message to tab ${tab.id}:`, e.message);
    }
  }
}

// Update link timers every second
setInterval(() => {
  if (!state.isRunning || state.isPaused) return;

  state.linkTimers.forEach((timer, index) => {
    if (!timer.paused && timer.startTime) {
      const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
      timer.remaining = Math.max(0, timer.total - elapsed);
    }
  });
}, 1000);

// Auto-resume functionality
setInterval(() => {
  if (state.isPaused && Date.now() - state.lastActivityTime > 180000) {
    resumeAllTimers();
  }
}, 30000);

// Periodic tab validation (every minute)
setInterval(async () => {
  if (!state.isRunning || state.isPaused) return;

  const allTabsValid = await validateAllTabsExist();
  if (!allTabsValid) {
    console.log('[Background] Some tabs are invalid during periodic check, recreating');
    try {
      await recreateTabs();
    } catch (e) {
      console.error('[Background] Failed to recreate tabs during periodic check:', e);
    }
  }
}, 60000);

async function validateAllTabsExist() {
  if (!state.tabs || state.tabs.length === 0) return false;

  for (const tab of state.tabs) {
    const exists = await validateTab(tab.id);
    if (!exists) return false;
  }
  return true;
}

// Keep alive
setInterval(() => chrome.storage.local.set({keepAlive: Date.now()}), 20000);