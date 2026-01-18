// Helper functions for encoding/decoding tab data
function encodeTabData(tab, group) {
  // Ultra-compact array format: [url, groupName, groupColor]
  // Omit group data if not in a group to save space
  const data = group ? [tab.url, group.title, group.color] : [tab.url];
  const json = JSON.stringify(data);
  // Use btoa directly without encodeURIComponent for shorter output
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeTabData(encoded) {
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json);
    return {
      url: data[0],
      title: '',
      groupTitle: data[1] || null,
      groupColor: data[2] || null
    };
  } catch (e) {
    return null;
  }
}

// Check if line is encoded format
function isEncodedFormat(line) {
  try {
    atob(line);
    return line.length > 20 && !line.includes(' ') && /^[A-Za-z0-9+/=]+$/.test(line);
  } catch (e) {
    return false;
  }
}

// Get all tabs and copy URLs to clipboard
document.getElementById('copyTabs').addEventListener('click', async () => {
  const statusDiv = document.getElementById('copyStatus');
  const urlInput = document.getElementById('urlInput');
  const includeGroups = document.getElementById('includeGroups').checked;
  const useEncoded = document.getElementById('useEncoded').checked;
  
  try {
    // Get all tabs in the current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Get all tab groups if we need group info
    const groups = {};
    if (includeGroups) {
      const allGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      allGroups.forEach(group => {
        groups[group.id] = {
          title: group.title || 'Untitled',
          color: group.color
        };
      });
    }
    
    // Extract URLs and group info from tabs
    let output;
    if (useEncoded) {
      // Encoded format - compact Base64 strings
      output = tabs.map(tab => {
        const group = (tab.groupId !== -1 && groups[tab.groupId]) ? groups[tab.groupId] : null;
        return encodeTabData(tab, group);
      }).join('\n');
    } else if (includeGroups) {
      // Plain text with group info
      output = tabs.map(tab => {
        if (tab.groupId !== -1 && groups[tab.groupId]) {
          const group = groups[tab.groupId];
          return `${tab.url} | ${group.title} | ${group.color}`;
        }
        return tab.url;
      }).join('\n');
    } else {
      // Plain URLs only
      output = tabs.map(tab => tab.url).join('\n');
    }
    
    // Copy to clipboard
    await navigator.clipboard.writeText(output);
    
    // Also populate the textarea
    urlInput.value = output;
    
    // Show success message
    const formatMsg = useEncoded ? ' (encoded)' : (includeGroups ? ' with groups' : '');
    statusDiv.textContent = `✓ Copied ${tabs.length} tabs${formatMsg} to clipboard!`;
    statusDiv.className = 'status success';
    
    // Clear message after 3 seconds
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
});

// Open tabs from textarea
document.getElementById('openTabs').addEventListener('click', async () => {
  const statusDiv = document.getElementById('openStatus');
  const urlInput = document.getElementById('urlInput');
  const restoreGroups = document.getElementById('restoreGroups').checked;
  
  try {
    // Get URLs from textarea
    const text = urlInput.value.trim();
    
    if (!text) {
      statusDiv.textContent = '✗ Please paste URLs first!';
      statusDiv.className = 'status error';
      return;
    }
    
    // Split by newlines and filter out empty lines
    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (lines.length === 0) {
      statusDiv.textContent = '✗ No valid URLs found!';
      statusDiv.className = 'status error';
      return;
    }
    
    // Parse lines for URLs and optional group info
    const tabsData = lines.map(line => {
      // Check if it's encoded format
      if (isEncodedFormat(line)) {
        const decoded = decodeTabData(line);
        if (decoded) return decoded;
      }
      
      // Plain text format
      const parts = line.split('|').map(p => p.trim());
      return {
        url: parts[0],
        title: '',
        groupTitle: parts[1] || null,
        groupColor: parts[2] || null
      };
    });
    
    // Validate URLs
    const validTabs = tabsData.filter(tab => 
      tab.url.startsWith('http://') || 
      tab.url.startsWith('https://') || 
      tab.url.startsWith('file://')
    );
    
    if (validTabs.length === 0) {
      statusDiv.textContent = '✗ No valid URLs found!';
      statusDiv.className = 'status error';
      return;
    }
    
    // Group tabs by their group title and color
    const groupMap = new Map();
    const ungroupedTabs = [];
    
    if (restoreGroups) {
      validTabs.forEach(tab => {
        if (tab.groupTitle && tab.groupColor) {
          const key = `${tab.groupTitle}|${tab.groupColor}`;
          if (!groupMap.has(key)) {
            groupMap.set(key, []);
          }
          groupMap.get(key).push(tab);
        } else {
          ungroupedTabs.push(tab);
        }
      });
    } else {
      ungroupedTabs.push(...validTabs);
    }
    
    let openedCount = 0;
    
    // Open ungrouped tabs
    for (const tab of ungroupedTabs) {
      await chrome.tabs.create({ url: tab.url, active: false });
      openedCount++;
    }
    
    // Open grouped tabs
    if (restoreGroups) {
      for (const [key, tabs] of groupMap.entries()) {
        const [groupTitle, groupColor] = key.split('|');
        const tabIds = [];
        
        // Create tabs
        for (const tab of tabs) {
          const newTab = await chrome.tabs.create({ url: tab.url, active: false });
          tabIds.push(newTab.id);
          openedCount++;
        }
        
        // Group the tabs
        if (tabIds.length > 0) {
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, {
            title: groupTitle,
            color: groupColor
          });
        }
      }
    }
    
    // Show success message
    const groupMsg = (restoreGroups && groupMap.size > 0) ? ` in ${groupMap.size} groups` : '';
    statusDiv.textContent = `✓ Opened ${openedCount} tabs${groupMsg}!`;
    statusDiv.className = 'status success';
    
    // Clear message after 3 seconds
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
});

// Export session to JSON file
document.getElementById('exportSession').addEventListener('click', async () => {
  const statusDiv = document.getElementById('sessionStatus');
  
  try {
    // Get all tabs in the current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Get all tab groups
    const groups = {};
    const allGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    allGroups.forEach(group => {
      groups[group.id] = {
        title: group.title || 'Untitled',
        color: group.color
      };
    });
    
    // Build session data
    const sessionData = {
      session: `Session_${new Date().toISOString().split('T')[0]}`,
      date: new Date().toISOString(),
      tabCount: tabs.length,
      tabs: tabs.map(tab => ({
        url: tab.url,
        title: tab.title,
        group: (tab.groupId !== -1 && groups[tab.groupId]) ? groups[tab.groupId].title : null,
        color: (tab.groupId !== -1 && groups[tab.groupId]) ? groups[tab.groupId].color : null
      }))
    };
    
    // Create and download JSON file
    const jsonString = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabs_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    statusDiv.textContent = `✓ Exported ${tabs.length} tabs to JSON!`;
    statusDiv.className = 'status success';
    
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
});

// Import session from JSON file
document.getElementById('importSession').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', async (event) => {
  const statusDiv = document.getElementById('sessionStatus');
  const file = event.target.files[0];
  
  if (!file) return;
  
  try {
    // Read the JSON file
    statusDiv.textContent = 'Loading file...';
    statusDiv.className = 'status';
    
    const text = await file.text();
    console.log('File loaded, length:', text.length);
    
    const sessionData = JSON.parse(text);
    console.log('JSON parsed:', sessionData);
    
    if (!sessionData.tabs || !Array.isArray(sessionData.tabs)) {
      throw new Error('Invalid JSON format - missing tabs array');
    }
    
    const totalTabs = sessionData.tabs.length;
    console.log('Total tabs in file:', totalTabs);
    
    statusDiv.textContent = `Found ${totalTabs} tabs, opening...`;
    
    // Group tabs by their group
    const groupMap = new Map();
    const ungroupedTabs = [];
    let skippedCount = 0;
    
    sessionData.tabs.forEach((tab, index) => {
      // Validate URL exists and is valid
      if (!tab.url || typeof tab.url !== 'string') {
        console.warn('Skipping tab', index, '- no URL:', tab);
        skippedCount++;
        return;
      }
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://') && !tab.url.startsWith('file://')) {
        console.warn('Skipping tab', index, '- invalid URL:', tab.url);
        skippedCount++;
        return;
      }
      
      if (tab.group && tab.color) {
        const key = `${tab.group}|${tab.color}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
        }
        groupMap.get(key).push(tab);
      } else {
        ungroupedTabs.push(tab);
      }
    });
    
    console.log('Ungrouped tabs:', ungroupedTabs.length);
    console.log('Groups:', groupMap.size);
    console.log('Skipped tabs:', skippedCount);
    
    let openedCount = 0;
    const devMode = document.getElementById('devMode').checked;
    
    if (devMode) {
      console.log('🛠️ DEV MODE: Simulating tab operations (not actually opening)');
    }
    
    // Open ungrouped tabs
    for (const tab of ungroupedTabs) {
      try {
        console.log('Opening ungrouped tab:', tab.url);
        if (!devMode) {
          await chrome.tabs.create({ url: tab.url, active: false });
        }
        openedCount++;
      } catch (err) {
        console.error('Failed to open tab:', tab.url, err);
      }
    }
    
    // Open grouped tabs
    for (const [key, tabs] of groupMap.entries()) {
      const [groupTitle, groupColor] = key.split('|');
      const tabIds = [];
      
      console.log(`Opening group "${groupTitle}" with ${tabs.length} tabs`);
      
      for (const tab of tabs) {
        try {
          console.log('Opening grouped tab:', tab.url);
          if (!devMode) {
            const newTab = await chrome.tabs.create({ url: tab.url, active: false });
            tabIds.push(newTab.id);
          } else {
            // Simulate tab ID in dev mode
            tabIds.push(1000 + openedCount);
          }
          openedCount++;
        } catch (err) {
          console.error('Failed to open tab:', tab.url, err);
        }
      }
      
      if (tabIds.length > 0 && !devMode) {
        try {
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, {
            title: groupTitle,
            color: groupColor
          });
          console.log(`Created group "${groupTitle}" with ${tabIds.length} tabs`);
        } catch (err) {
          console.error('Failed to create group:', groupTitle, err);
        }
      } else if (tabIds.length > 0) {
        console.log(`🛠️ DEV: Would create group "${groupTitle}" with ${tabIds.length} tabs`);
      }
    }
    
    console.log('Total opened:', openedCount, 'of', totalTabs);
    
    if (openedCount === 0) {
      statusDiv.textContent = `✗ No tabs opened! Check console (F12) for details`;
      statusDiv.className = 'status error';
    } else {
      const msg = skippedCount > 0 ? ` (${skippedCount} skipped)` : '';
      const devMsg = devMode ? ' [DEV MODE - SIMULATED]' : '';
      statusDiv.textContent = `✓ ${devMode ? 'Simulated' : 'Imported'} ${openedCount}/${totalTabs} tabs${msg}${devMsg}!`;
      statusDiv.className = 'status success';
    }
    statusDiv.className = 'status success';
    
    // Reset file input
    event.target.value = '';
    
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
    event.target.value = '';
  }
});

// Close duplicate tabs
document.getElementById('closeDuplicates').addEventListener('click', async () => {
  const statusDiv = document.getElementById('duplicateStatus');
  
  try {
    // Get all tabs in the current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Track URLs and find duplicates
    const urlMap = new Map();
    const duplicatesToClose = [];
    
    tabs.forEach(tab => {
      if (urlMap.has(tab.url)) {
        // This is a duplicate - mark for closing
        duplicatesToClose.push(tab.id);
      } else {
        // First occurrence - keep it
        urlMap.set(tab.url, tab.id);
      }
    });
    
    if (duplicatesToClose.length === 0) {
      statusDiv.textContent = '✓ No duplicate tabs found!';
      statusDiv.className = 'status success';
    } else {
      // Close all duplicate tabs
      await chrome.tabs.remove(duplicatesToClose);
      
      statusDiv.textContent = `✓ Closed ${duplicatesToClose.length} duplicate tabs!`;
      statusDiv.className = 'status success';
    }
    
    // Clear message after 3 seconds
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
});
