// Get all tabs and copy URLs to clipboard
document.getElementById('copyTabs').addEventListener('click', async () => {
  const statusDiv = document.getElementById('copyStatus');
  const urlInput = document.getElementById('urlInput');
  const includeGroups = document.getElementById('includeGroups').checked;
  
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
    if (includeGroups) {
      output = tabs.map(tab => {
        if (tab.groupId !== -1 && groups[tab.groupId]) {
          const group = groups[tab.groupId];
          return `${tab.url} | ${group.title} | ${group.color}`;
        }
        return tab.url;
      }).join('\n');
    } else {
      output = tabs.map(tab => tab.url).join('\n');
    }
    
    // Copy to clipboard
    await navigator.clipboard.writeText(output);
    
    // Also populate the textarea
    urlInput.value = output;
    
    // Show success message
    const groupMsg = includeGroups ? ' with group info' : '';
    statusDiv.textContent = `✓ Copied ${tabs.length} tabs${groupMsg} to clipboard!`;
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
      const parts = line.split('|').map(p => p.trim());
      return {
        url: parts[0],
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
