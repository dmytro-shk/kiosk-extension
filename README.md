# Kiosk Tab Rotator Pro

A powerful Chrome extension for creating interactive kiosk displays with advanced control features, click blocking, and security options.

## Features

### 🔄 **Automatic Tab Rotation**
- Configure multiple URLs with individual timing settings
- Set custom switch intervals for each tab (10-3600 seconds)
- Optional page refresh before switching tabs
- Smooth transitions between tabs

### 🔒 **Advanced Click Blocking**
- Block all user interactions after a specified time
- Password-protected unlock mechanism (5 clicks + password)
- Per-link override - allow clicks on specific trusted websites
- Visual feedback for blocked interactions

### 🎮 **Control Modes**
- **Normal Mode**: Full blocking with invisible overlay
- **Hover Mode**: Allow mouse hover while blocking clicks
- **Unlocked Mode**: Temporary full access with auto-lock after 5 minutes
- **Per-Link Allow**: Override blocking for specific links

### 🎯 **Interactive Control Panel**
- Floating menu button with real-time timer display
- Quick access controls:
  - ⏸️ Pause/Resume timer
  - ⏭️ Skip to next tab
  - 👆 Enable/Disable hover mode
  - 🔓 Lock/Unlock screen
  - ❌ Exit kiosk mode (when unlocked)

### 🔐 **Security Features**
- Password protection for unlocking interactions
- Extension UI lock - prevents unauthorized settings changes
- Auto-lock after 5 minutes of inactivity
- Password visibility toggle for secure entry

### ⚙️ **Configuration Options**
- Fullscreen mode support
- Auto-start on browser launch
- Individual link settings:
  - Switch interval
  - Refresh timing
  - Click blocking delay
  - Allow clicks override

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your toolbar

## Usage

### Basic Setup

1. **Click the extension icon** to open the settings popup
2. **Add your URLs**:
   - Click "+ Add Link" to add more URLs
   - Enter the full URL (including https://)
   - Configure timing for each link
3. **Configure Global Settings**:
   - Set unlock password (optional but recommended)
   - Enable fullscreen mode if desired
   - Enable auto-start for unattended kiosks
4. **Save Settings** using the blue button at the bottom
5. **Start Kiosk** to begin rotation

### Link Configuration

Each link has individual settings:

- **Switch Interval**: Time to display this tab (seconds)
- **Refresh Before**: Refresh page X seconds before switching
- **Enable Refresh**: Toggle page refresh on/off
- **Block Clicks After**: Start blocking interactions after X seconds
- **✓ Allow Clicks**: Override blocking for this specific link

### Unlocking Interactions

When clicks are blocked, you can unlock in several ways:

1. **Password Unlock**:
   - Click 5 times anywhere on the page
   - Enter the configured password
   - Screen unlocks for 5 minutes

2. **Menu Controls**:
   - The menu button remains accessible when locked
   - Use the 🔓 Unlock button in the menu
   - Enter password when prompted

3. **Hover Mode**:
   - Enable via menu to allow mouse hover
   - Clicks remain blocked but hover effects work

### Control Panel

The floating control panel (bottom center) provides:

- **Timer Display**: Shows remaining time for current tab
- **Status Indicator**: Color-coded button shows current state
  - 🟣 Purple: Normal operation
  - 🟡 Yellow: Paused
  - 🔴 Red: Locked
  - 🟢 Green: Unlocked
- **Quick Actions**: Click to open menu with all controls

### Keyboard Shortcuts

When unlocked:
- **ESC**: Exit fullscreen (if enabled)
- **Tab**: Navigate between elements
- **Enter/Space**: Activate buttons

## Advanced Features

### Per-Site Configuration

Different sites can have different interaction models:
- Display-only dashboards: Full blocking
- Interactive forms: Allow clicks enabled
- Mixed content: Use hover mode

### Multi-Frame Support

The extension works across:
- Main pages
- Iframes
- Shadow DOM elements
- Dynamically loaded content

### Security Considerations

- Passwords are stored locally in Chrome sync storage
- No external connections or data transmission
- All blocking happens client-side
- Extension UI locks when kiosk is running (if password set)

## Troubleshooting

### Clicks Not Blocking
- Check if "Allow Clicks" is enabled for that link
- Verify the blocking timer has elapsed
- Ensure the extension has permissions for the site

### Menu Button Not Visible
- Look for the round button at bottom center
- Check if page CSS might be hiding it
- Refresh the page to reload the content script

### Password Not Working
- Passwords are case-sensitive
- Check for extra spaces
- Re-save settings if password was recently changed

### Extension UI Locked
- This happens when kiosk is running with a password
- Enter the same password used for unlock
- Stop the kiosk to regain immediate access

## Browser Compatibility

- Chrome: Version 88+ (Manifest V3 support)
- Edge: Version 88+ (Chromium-based)
- Other Chromium browsers: Should work but untested

## Privacy & Permissions

Required permissions:
- **tabs**: Switch between tabs
- **storage**: Save configuration
- **scripting**: Inject content scripts
- **webNavigation**: Track page loads
- **windows**: Fullscreen support
- **host_permissions**: Access all sites (for click blocking)

## Support

For issues, feature requests, or questions:
1. Check the troubleshooting section above
2. Review existing issues on GitHub
3. Create a new issue with detailed description

## License

This extension is provided as-is for personal and commercial use.

## Version

Current Version: 1.0.0

## Changelog

### Version 1.0.0
- Initial release
- Multi-tab rotation with individual timers
- Advanced click blocking system
- Password protection and unlock mechanisms
- Hover mode for partial interaction
- Per-link click override
- Interactive control panel
- Extension UI lock
- Fullscreen support
- Auto-start capability