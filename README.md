# Tab Manager - Brave Extension

A simple Brave/Chrome extension to copy all tab URLs and open them later.

## Features

- 📋 **Copy All Tabs**: Copies all tab URLs from the current window to your clipboard
- 🎨 **Group Support**: Preserves tab group information (name and color)
- 🚀 **Open Tabs**: Opens multiple URLs from pasted text (one per line)
- 🔄 **Restore Groups**: Automatically recreates tab groups when opening saved tabs
- Simple and intuitive interface
- Works with Brave, Chrome, and other Chromium-based browsers

## Installation

### Option 1: Install in Brave (Developer Mode)

1. Open Brave browser
2. Go to `brave://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `brawe-extencion` folder
6. The extension icon will appear in your toolbar

### Option 2: Install in Chrome

1. Open Chrome browser
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `brawe-extencion` folder

## Usage

### Copy All Tabs
1. Click the extension icon in your toolbar
2. Check/uncheck "Include group information" as desired
3. Click **"📋 Copy All Tabs"** button
4. All tab URLs (and group info if enabled) are copied to clipboard
5. You can now paste them anywhere (email, text file, etc.)

### Open Tabs
1. Paste URLs or tab data into the text area (one URL per line)
   - Simple format: `https://example.com`
   - With groups: `https://example.com | Work | blue`
2. Check/uncheck "Restore groups if available"
3. Click **"🚀 Open Tabs"** button
4. All valid URLs will open, and groups will be recreated if enabled

### Tab Group Format
When "Include group information" is enabled, tabs are saved in this format:
```
URL | GroupName | Color
```
Example:
```
https://github.com | Development | blue
https://stackoverflow.com | Development | blue
https://gmail.com | Personal | red
```

## File Structure

```
brawe-extencion/
├── manifest.json       # Extension configuration
├── popup.html          # Extension popup interface
├── popup.js            # Main functionality
├── popup.css           # Styling
├── icon16.png          # Extension icon (16x16)
├── icon48.png          # Extension icon (48x48)
├── icon128.png         # Extension icon (128x128)
└── README.md           # This file
```

## Note About Icons

The extension requires icon files. You can:
- Create your own icons (16x16, 48x48, and 128x128 pixels)
- Use any PNG image and rename them to `icon16.png`, `icon48.png`, and `icon128.png`
- Use an online icon generator

## Permissions

This extension requires the following permissions:
- **tabs**: To access and read tab URLs
- **tabGroups**: To access and manage tab groups

## License

Free to use and modify.
