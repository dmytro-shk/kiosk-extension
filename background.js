const state = {
  config: {
    links: [],
    kioskMode: false,
    autoStart: false,
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
  lastActivityTime: Date.now(),
  globalUnlocked: false,
  hoverModeEnabled: false
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
            blockClicksAfter: config.blockClicksAfter || 120,
            allowClicks: false,
            escapeEnabled: false,
            escapeFrequency: 10,
            escapeMaxTimes: 5
          });
          if (config.url2) links.push({
            id: 'link_2',
            url: config.url2,
            switchInterval: config.switchInterval || 30,
            refreshBeforeSwitch: config.refreshBeforeSwitch || 5,
            refreshEnabled: true,
            blockClicksAfter: config.blockClicksAfter || 120,
            allowClicks: false,
            escapeEnabled: false,
            escapeFrequency: 10,
            escapeMaxTimes: 5
          });

          state.config = {
            links,
            kioskMode: config.kioskMode || false,
            autoStart: config.autoStart || false,
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

          // Migrate existing links to include escape settings if missing
          if (state.config.links) {
            let needsMigration = false;
            state.config.links = state.config.links.map(link => {
              if (!link.hasOwnProperty('escapeEnabled')) {
                needsMigration = true;
                return {
                  ...link,
                  escapeEnabled: false,
                  escapeFrequency: 10,
                  escapeMaxTimes: 5
                };
              }
              return link;
            });

            // Save migrated config if needed
            if (needsMigration) {
              console.log('[Background] Migrating existing links to include escape settings');
              chrome.storage.sync.set({config: state.config}, () => {
                if (chrome.runtime.lastError) {
                  console.error('[Background] Failed to save escaped-migrated config:', chrome.runtime.lastError);
                } else {
                  console.log('[Background] Escape-migrated config saved');
                }
              });
            }
          }

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
        const oldConfig = state.config;
        Object.assign(state.config, changes.config.newValue);
        console.log('[Background] Updated config:', state.config);

        if (state.isRunning) {
          // Instead of restarting everything, just update the timers and broadcast
          console.log('[Background] Updating running kiosk with new config');

          // Clear any existing timers
          Object.values(state.timers).forEach(t => t && clearTimeout(t));
          state.timers = {};

          // Reschedule current link with new configuration
          scheduleCurrentLink();
          broadcast();
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
      },
      pauseCurrentTab: () => {
        pauseCurrentTabTimer();
        return {status: 'current tab paused'};
      },
      resumeCurrentTab: () => {
        resumeCurrentTabTimer();
        return {status: 'current tab resumed'};
      },
      forceNextTab: () => {
        forceNextTab();
        return {status: 'forced next tab'};
      },
      setGlobalUnlock: (unlocked) => {
        setGlobalUnlock(unlocked);
        return {status: 'global unlock set'};
      },
      setHoverMode: (enabled) => {
        setHoverMode(enabled);
        return {status: 'hover mode set'};
      },
      exitKiosk: () => {
        exitChromeProcess();
        return {status: 'exiting chrome'};
      },
      requestCurrentState: () => {
        if (state.isRunning) {
          // Send current state to the requesting tab
          sendCurrentStateToTab(sender.tab.id);
        }
        return {status: 'current state sent'};
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

  // Request permissions for the configured URLs only
  const urls = state.config.links.map(link => {
    try {
      const url = new URL(link.url);
      return `${url.protocol}//${url.hostname}/*`;
    } catch (e) {
      console.warn(`Invalid URL: ${link.url}`);
      return null;
    }
  }).filter(Boolean);

  if (urls.length > 0) {
    try {
      const hasPermissions = await chrome.permissions.request({
        origins: urls
      });

      if (!hasPermissions) {
        console.error('Required permissions not granted');
        return;
      }
      console.log('Permissions granted for:', urls);
    } catch (e) {
      console.error('Permission request failed:', e);
      return;
    }
  }

  state.isRunning = true;
  state.isPaused = false;
  state.startTime = Date.now();
  state.currentTabIndex = 0;

  initializeLinkTimers();

  try {
    const tabUrls = state.config.links.map(link => link.url);
    const win = await chrome.windows.create({
      url: tabUrls,
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

async function stopKioskMode() {
  state.isRunning = false;
  state.isPaused = false;
  state.startTime = null;
  state.pauseTime = null;

  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};
  state.linkTimers = [];

  state.tabs.forEach(t => chrome.tabs.remove(t.id).catch(() => {}));
  state.tabs = [];

  // Optional: Remove permissions when stopping (uncomment if you want to revoke permissions)
  // if (state.config.links && state.config.links.length > 0) {
  //   const urls = state.config.links.map(link => {
  //     try {
  //       const url = new URL(link.url);
  //       return `${url.protocol}//${url.hostname}/*`;
  //     } catch (e) {
  //       return null;
  //     }
  //   }).filter(Boolean);
  //
  //   if (urls.length > 0) {
  //     try {
  //       await chrome.permissions.remove({ origins: urls });
  //       console.log('Permissions revoked for:', urls);
  //     } catch (e) {
  //       console.warn('Failed to revoke permissions:', e);
  //     }
  //   }
  // }
}

function initializeLinkTimers() {
  state.linkTimers = state.config.links.map((link, index) => ({
    linkId: link.id,
    total: link.switchInterval,
    remaining: link.switchInterval,
    startTime: index === 0 ? Date.now() : null, // Only set startTime for the first tab
    paused: false
  }));
}

function pauseAllTimers() {
  if (!state.isRunning) return;

  state.isPaused = true;
  state.pauseTime = Date.now();

  // Store the remaining time for the current tab before pausing
  const currentTimer = state.linkTimers[state.currentTabIndex];
  if (currentTimer && currentTimer.startTime) {
    const elapsed = Math.floor((Date.now() - currentTimer.startTime) / 1000);
    currentTimer.remaining = Math.max(0, currentTimer.total - elapsed);
    currentTimer.pausedAt = currentTimer.remaining; // Store where we paused
  }

  // Clear all timers including switch and refresh timers
  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};

  // Mark all link timers as paused
  state.linkTimers.forEach(timer => {
    timer.paused = true;
  });

  // Notify all tabs about the pause state
  state.tabs.forEach(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'updatePauseState',
        isPaused: true
      });
    } catch (e) {
      // Tab might not be ready
    }
  });

  console.log('All timers paused globally');
}

function resumeAllTimers() {
  if (!state.isRunning || !state.isPaused) return;

  state.isPaused = false;

  // Get the current timer to resume from where it was paused
  const currentTimer = state.linkTimers[state.currentTabIndex];
  if (currentTimer && currentTimer.pausedAt !== undefined) {
    // Keep the remaining time from when it was paused (don't reset startTime)
    currentTimer.remaining = currentTimer.pausedAt;
    currentTimer.paused = false;

    // Only reschedule if there's time remaining
    const currentLink = state.config.links[state.currentTabIndex];
    if (currentLink && currentTimer.remaining > 0) {
      const remainingMs = currentTimer.remaining * 1000;

      // Clear any existing timers first
      if (state.timers.switch) clearTimeout(state.timers.switch);
      if (state.timers.refresh) clearTimeout(state.timers.refresh);

      // Reschedule switch timer with remaining time
      state.timers.switch = setTimeout(() => switchTab(), remainingMs);
      console.log(`Resumed: Switch timer scheduled in ${remainingMs}ms (${currentTimer.remaining}s remaining)`);

      // Check if we need to schedule refresh
      const refreshTime = (currentTimer.remaining - currentLink.refreshBeforeSwitch) * 1000;
      if (currentLink.refreshEnabled && refreshTime > 0) {
        state.timers.refresh = setTimeout(() => {
          const nextIndex = (state.currentTabIndex + 1) % state.tabs.length;
          chrome.tabs.reload(state.tabs[nextIndex].id);
        }, refreshTime);
        console.log(`Resumed: Refresh scheduled in ${refreshTime}ms`);
      }
    } else if (currentTimer.remaining <= 0) {
      // If timer expired (0 or less seconds), switch immediately
      console.log(`Resumed: Timer already expired (${currentTimer.remaining}s remaining), switching tab immediately`);
      setTimeout(() => switchTab(), 0);
    }
  } else {
    // If no pause info, restart the current link's timer
    scheduleCurrentLink();
  }

  // Mark all timers as unpaused
  state.linkTimers.forEach(timer => {
    if (timer !== currentTimer) {
      timer.startTime = Date.now();
    }
    timer.paused = false;
    delete timer.pausedAt; // Clean up pause tracking
  });

  // Notify all tabs about the resume state
  state.tabs.forEach(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'updatePauseState',
        isPaused: false
      });
    } catch (e) {
      // Tab might not be ready
    }
  });

  broadcast();

  console.log('All timers resumed globally');
}

function pauseCurrentTabTimer() {
  if (!state.isRunning || state.isPaused) return;

  const currentTimer = state.linkTimers[state.currentTabIndex];
  if (currentTimer && !currentTimer.paused) {
    currentTimer.paused = true;

    // Clear the current timers since we're pausing this tab
    Object.values(state.timers).forEach(t => t && clearTimeout(t));
    state.timers = {};

    console.log(`Paused timer for tab ${state.currentTabIndex + 1}`);
  }
}

function resumeCurrentTabTimer() {
  if (!state.isRunning || state.isPaused) return;

  const currentTimer = state.linkTimers[state.currentTabIndex];
  const currentLink = state.config.links[state.currentTabIndex];
  if (currentTimer && currentTimer.paused && currentLink) {
    currentTimer.paused = false;
    // Reset to full time when resuming individual tab
    currentTimer.remaining = currentLink.switchInterval;
    currentTimer.startTime = Date.now();

    // Restart the timer for this tab
    scheduleCurrentLink();

    console.log(`Resumed timer for tab ${state.currentTabIndex + 1}`);
  }
}


function scheduleCurrentLink() {
  if (!state.isRunning || state.isPaused) return;

  const currentLink = state.config.links[state.currentTabIndex];
  const currentTimer = state.linkTimers[state.currentTabIndex];

  if (!currentLink || !currentTimer || currentTimer.paused) return;

  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};

  // Always use the full switchInterval from the link configuration, not the remaining time
  const switchTime = currentLink.switchInterval * 1000;

  // Get the NEXT tab's refresh settings since we're refreshing the next tab before switching to it
  const nextIndex = (state.currentTabIndex + 1) % state.tabs.length;
  const nextLink = state.config.links[nextIndex];

  // Safety check: ensure we have the corresponding link config
  if (!nextLink) {
    console.warn(`No link config found for next index ${nextIndex}, skipping refresh scheduling`);
  }

  const refreshTime = nextLink?.refreshEnabled ?
    Math.max(0, switchTime - (nextLink.refreshBeforeSwitch * 1000)) : -1;

  console.log(`Scheduling for tab ${state.currentTabIndex + 1}: nextTab=${nextIndex + 1}, nextTabRefreshEnabled=${nextLink?.refreshEnabled}, refreshTime=${refreshTime}, switchTime=${switchTime}`);

  if (nextLink?.refreshEnabled && refreshTime > 0 && refreshTime < switchTime) {
    state.timers.refresh = setTimeout(() => refresh(), refreshTime);
    console.log(`Refresh scheduled in ${refreshTime}ms for next tab ${nextIndex + 1}`);
  } else {
    console.log(`Refresh NOT scheduled for next tab ${nextIndex + 1} - refreshEnabled: ${nextLink?.refreshEnabled}`);
  }

  state.timers.switch = setTimeout(() => switchTab(), switchTime);
  console.log(`Switch timer scheduled in ${switchTime}ms for tab ${state.currentTabIndex + 1}`);

  // Only reset timer if it's a new scheduling (not from pause/resume)
  if (!currentTimer.startTime || currentTimer.remaining === 0) {
    currentTimer.startTime = Date.now();
    currentTimer.remaining = currentLink.switchInterval;
  }
}

async function refresh() {
  if (!state.isRunning || state.isPaused || !state.tabs.length) return;

  const nextIndex = (state.currentTabIndex + 1) % state.tabs.length;
  const nextLink = state.config.links[nextIndex];

  console.log(`Refresh function called - refreshing next tab ${nextIndex + 1}, refreshEnabled: ${nextLink?.refreshEnabled}`);

  // Safety check: ensure we have the corresponding link config
  if (!nextLink) {
    console.warn(`No link config found for next index ${nextIndex}, skipping refresh`);
    return;
  }

  // Double-check if refresh is still enabled for the NEXT tab (the one we're refreshing)
  if (!nextLink.refreshEnabled) {
    console.log('Refresh called but next tab refreshEnabled is false, skipping refresh');
    return;
  }

  try {
    // Verify tab exists before refreshing
    const tabExists = await validateTab(state.tabs[nextIndex].id);
    if (!tabExists) {
      console.log('Tab to refresh no longer exists, skipping refresh');
      return;
    }

    await chrome.tabs.reload(state.tabs[nextIndex].id);
    console.log(`Refreshed next tab ${nextIndex + 1}`);
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

  // Notify old tab it's becoming inactive
  const oldTabId = state.tabs[state.currentTabIndex]?.id;
  if (oldTabId) {
    try {
      await chrome.tabs.sendMessage(oldTabId, {action: 'tabBecameInactive'});
    } catch (e) {
      // Tab might be closed or not ready
    }
  }

  state.currentTabIndex = (state.currentTabIndex + 1) % state.tabs.length;

  // Reset the new current tab's timer
  const newTimer = state.linkTimers[state.currentTabIndex];
  if (newTimer) {
    newTimer.remaining = newTimer.total;
    newTimer.startTime = Date.now();
  }

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

    // Notify new tab it became active
    try {
      await chrome.tabs.sendMessage(state.tabs[state.currentTabIndex].id, {action: 'tabBecameActive'});
    } catch (e) {
      // Tab might not be ready for messages yet
    }

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

  const currentTimer = state.linkTimers[state.currentTabIndex];

  const msg = {
    action: 'updateClickBlock',
    startTime: state.startTime,
    blockAfter: currentLink.blockClicksAfter * 1000,
    unlockPassword: state.config.unlockPassword,
    currentTabTimer: currentTimer,
    unlocked: state.globalUnlocked,
    isPaused: state.isPaused,
    hoverModeEnabled: state.hoverModeEnabled,
    allowClicks: currentLink.allowClicks || false,
    escapeEnabled: currentLink.escapeEnabled || false,
    escapeFrequency: currentLink.escapeFrequency || 10,
    escapeMaxTimes: currentLink.escapeMaxTimes || 5
  };

  // Send message to each tab, ignoring failures for closed tabs
  for (let i = 0; i < state.tabs.length; i++) {
    const tab = state.tabs[i];
    try {
      // Send timer info only to the active tab
      if (i === state.currentTabIndex) {
        await chrome.tabs.sendMessage(tab.id, msg);
      } else {
        // Send basic update to inactive tabs
        const inactiveTabLink = state.config.links[i];
        await chrome.tabs.sendMessage(tab.id, {
          action: 'updateClickBlock',
          startTime: state.startTime,
          blockAfter: inactiveTabLink ? inactiveTabLink.blockClicksAfter * 1000 : currentLink.blockClicksAfter * 1000,
                unlockPassword: state.config.unlockPassword,
          unlocked: state.globalUnlocked,
          isPaused: state.isPaused,
          hoverModeEnabled: state.hoverModeEnabled,
          allowClicks: inactiveTabLink ? (inactiveTabLink.allowClicks || false) : false,
          escapeEnabled: inactiveTabLink ? (inactiveTabLink.escapeEnabled || false) : false,
          escapeFrequency: inactiveTabLink ? (inactiveTabLink.escapeFrequency || 10) : 10,
          escapeMaxTimes: inactiveTabLink ? (inactiveTabLink.escapeMaxTimes || 5) : 5
        });
      }
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
    if (timer.startTime && !timer.paused) {
      // Decrement by 1 second instead of recalculating from startTime to avoid drift
      timer.remaining = Math.max(0, timer.remaining - 1);
    }
  });

  // Update the active tab's timer display
  if (state.tabs[state.currentTabIndex]) {
    const currentTimer = state.linkTimers[state.currentTabIndex];
    chrome.tabs.sendMessage(state.tabs[state.currentTabIndex].id, {
      action: 'updateTimer',
      currentTabTimer: currentTimer
    }).catch(() => {
      // Tab might not be ready for messages
    });
  }
}, 1000);

// Auto-resume functionality (disabled to prevent unwanted resumes)
// Uncomment below to enable auto-resume after 3 minutes of inactivity
/*
setInterval(() => {
  if (state.isPaused && Date.now() - state.lastActivityTime > 180000) {
    resumeAllTimers();
  }
}, 30000);
*/

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

// Force next tab function
async function forceNextTab() {
  if (!state.isRunning || !state.tabs.length) return;

  // Clear current timers before forcing switch
  Object.values(state.timers).forEach(t => t && clearTimeout(t));
  state.timers = {};

  // Manually switch to next tab
  await switchTab();
}

// Exit Chrome process function
async function exitChromeProcess() {
  try {
    console.log('Exiting Chrome process...');

    // Stop kiosk mode first
    if (state.isRunning) {
      stopKioskMode();
    }

    // Close all Chrome windows
    const windows = await chrome.windows.getAll();
    for (const window of windows) {
      try {
        await chrome.windows.remove(window.id);
      } catch (e) {
        console.log(`Failed to close window ${window.id}:`, e);
      }
    }
  } catch (e) {
    console.error('Failed to exit Chrome:', e);
  }
}

// Send current state to a specific tab
async function sendCurrentStateToTab(tabId) {
  if (!state.isRunning || !state.startTime) return;

  const currentLink = state.config.links[state.currentTabIndex];
  if (!currentLink) return;

  const currentTimer = state.linkTimers[state.currentTabIndex];

  const msg = {
    action: 'updateClickBlock',
    startTime: state.startTime,
    blockAfter: currentLink.blockClicksAfter * 1000,
    unlockPassword: state.config.unlockPassword,
    currentTabTimer: currentTimer,
    unlocked: state.globalUnlocked,
    isPaused: state.isPaused,
    hoverModeEnabled: state.hoverModeEnabled,
    allowClicks: currentLink.allowClicks || false,
    escapeEnabled: currentLink.escapeEnabled || false,
    escapeFrequency: currentLink.escapeFrequency || 10,
    escapeMaxTimes: currentLink.escapeMaxTimes || 5
  };

  try {
    await chrome.tabs.sendMessage(tabId, msg);
    console.log(`Sent current state to tab ${tabId}`);
  } catch (e) {
    console.log(`Failed to send current state to tab ${tabId}:`, e.message);
  }
}

// Global unlock state management
function setGlobalUnlock(unlocked) {
  state.globalUnlocked = unlocked;

  // Notify all tabs about the new unlock state
  state.tabs.forEach(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'updateUnlockState',
        unlocked: unlocked
      });
    } catch (e) {
      // Tab might not be ready
    }
  });
}

// Hover mode state management
function setHoverMode(enabled) {
  state.hoverModeEnabled = enabled;

  // Notify all tabs about the new hover mode state
  state.tabs.forEach(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'updateHoverMode',
        hoverModeEnabled: enabled
      });
    } catch (e) {
      // Tab might not be ready
    }
  });
}

// Keep alive
setInterval(() => chrome.storage.local.set({keepAlive: Date.now()}), 20000);