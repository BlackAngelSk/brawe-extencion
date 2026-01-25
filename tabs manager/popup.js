// Update tab count display
async function updateTabCount() {
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const allTabs = await chrome.tabs.query({});
  
  const tabCountElement = document.getElementById('tabCount');
  const allTabCountElement = document.getElementById('allTabCount');
  
  if (tabCountElement) {
    tabCountElement.textContent = currentWindowTabs.length;
  }
  if (allTabCountElement) {
    allTabCountElement.textContent = allTabs.length;
  }
}

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

function calculatePrivacyScore(thirdPartyCount, trackerCount) {
  const base = 100;
  const trackerPenalty = Math.min(60, trackerCount * 12);
  const thirdPartyPenalty = Math.min(30, Math.max(0, thirdPartyCount - 2) * 2);
  return Math.max(0, Math.round(base - trackerPenalty - thirdPartyPenalty));
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

document.getElementById('scanPrivacy').addEventListener('click', async () => {
  const statusDiv = document.getElementById('privacyStatus');
  const summaryCard = document.getElementById('privacySummary');
  const scoreElement = document.getElementById('privacyScore');
  const thirdPartyCountElement = document.getElementById('thirdPartyCount');
  const trackerCountElement = document.getElementById('trackerCount');
  const thirdPartyList = document.getElementById('thirdPartyList');

  statusDiv.textContent = 'Scanning active tab...';
  statusDiv.className = 'status';
  summaryCard.classList.add('hidden');

  try {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      throw new Error('Scripting API unavailable. Reload the extension or update browser.');
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab) {
      statusDiv.textContent = '✗ No active tab found';
      statusDiv.className = 'status error';
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        try {
          const trackerDomains = [
            'google-analytics.com',
            'googletagmanager.com',
            'doubleclick.net',
            'googlesyndication.com',
            'facebook.com',
            'connect.facebook.net',
            'adsystem.com',
            'adservice.google.com',
            'scorecardresearch.com',
            'quantserve.com',
            'hotjar.com',
            'fullstory.com',
            'amplitude.com',
            'mixpanel.com',
            'segment.io',
            'sentry.io',
            'datadoghq.com',
            'newrelic.com',
            'bugsnag.com',
            'intercom.io',
            'braze.com',
            'optimizely.com',
            'taboola.com',
            'criteo.com',
            'cloudflareinsights.com',
            'clarity.ms'
          ];

          const normalize = (host) => host.replace(/^www\./, '').toLowerCase();
          const pageHost = normalize(location.hostname);
          const resources = performance.getEntriesByType('resource') || [];
          const thirdPartyHosts = new Set();
          const trackerHosts = new Set();

          resources.forEach((entry) => {
            if (!entry.name) return;
            let hostname;
            try {
              hostname = new URL(entry.name, location.href).hostname;
            } catch (err) {
              return;
            }

            const normalizedHost = normalize(hostname);
            const isThirdParty = normalizedHost !== pageHost && !normalizedHost.endsWith(`.${pageHost}`);

            if (isThirdParty) {
              thirdPartyHosts.add(normalizedHost);
              const match = trackerDomains.find((domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
              if (match) {
                trackerHosts.add(normalizedHost);
              }
            }
          });

          return {
            pageHost,
            thirdPartyHosts: Array.from(thirdPartyHosts),
            trackerHosts: Array.from(trackerHosts)
          };
        } catch (err) {
          return { error: err.message || String(err) };
        }
      }
    });

    if (!result || result.error) {
      throw new Error(result?.error || 'Failed to collect scan data');
    }

    const score = calculatePrivacyScore(result.thirdPartyHosts.length, result.trackerHosts.length);

    scoreElement.textContent = `${score}/100`;
    thirdPartyCountElement.textContent = result.thirdPartyHosts.length;
    trackerCountElement.textContent = result.trackerHosts.length;

    thirdPartyList.innerHTML = '';
    if (result.thirdPartyHosts.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No third-party requests detected.';
      thirdPartyList.appendChild(li);
    } else {
      result.thirdPartyHosts.sort().forEach((host) => {
        const li = document.createElement('li');
        const isTracker = result.trackerHosts.includes(host);
        li.textContent = isTracker ? `${host} • tracker` : host;
        thirdPartyList.appendChild(li);
      });
    }

    summaryCard.classList.remove('hidden');
    statusDiv.textContent = '✓ Scan complete';
    statusDiv.className = 'status success';

    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
  } catch (error) {
    statusDiv.textContent = `✗ ${error.message}`;
    statusDiv.className = 'status error';
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

// Initialize tab count on popup load
updateTabCount();

// Listen for tab changes to update the count
chrome.tabs.onCreated.addListener(updateTabCount);
chrome.tabs.onRemoved.addListener(updateTabCount);
chrome.tabs.onAttached.addListener(updateTabCount);
chrome.tabs.onDetached.addListener(updateTabCount);

// Collapsible helpers
function initCollapsibles() {
  const toggles = document.querySelectorAll('.collapse-toggle');
  toggles.forEach((btn) => {
    const targetId = btn.getAttribute('data-target');
    const target = document.getElementById(targetId);
    if (!target) return;
    btn.addEventListener('click', () => {
      const collapsed = target.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', (!collapsed).toString());
      btn.textContent = collapsed ? '▸' : '▾';
    });
  });
}

initCollapsibles();

// Video downloader enable/disable
let videoDownloaderEnabled = true;

function applyVideoDownloaderState() {
  const toggle = document.getElementById('videoDownloaderToggle');
  const status = document.getElementById('videoToggleStatus');
  const disabledMessage = 'Video downloader is off. Toggle it on to enable scanning and downloads.';
  const buttons = [
    document.getElementById('scanNetworkVideos'),
    document.getElementById('downloadVideo'),
    document.getElementById('detectVideo')
  ];

  if (toggle) {
    toggle.checked = videoDownloaderEnabled;
  }

  buttons.forEach((btn) => {
    if (!btn) return;
    btn.disabled = !videoDownloaderEnabled;
    btn.classList.toggle('disabled', !videoDownloaderEnabled);
  });

  if (status) {
    status.textContent = videoDownloaderEnabled ? 'Video downloader is on' : disabledMessage;
    status.className = 'status subtle';
  }

  if (!videoDownloaderEnabled) {
    const videoStatus = document.getElementById('videoStatus');
    if (videoStatus) {
      videoStatus.textContent = disabledMessage;
      videoStatus.className = 'status warning';
    }
  } else {
    const videoStatus = document.getElementById('videoStatus');
    if (videoStatus && videoStatus.textContent.startsWith('Video downloader is')) {
      videoStatus.textContent = '';
      videoStatus.className = 'status';
    }
  }
}

async function setVideoDownloaderEnabled(enabled, { persist = true } = {}) {
  videoDownloaderEnabled = enabled;
  applyVideoDownloaderState();

  if (!persist) return;

  await chrome.storage.local.set({ videoDownloaderEnabled });

  // Update background service worker
  chrome.runtime.sendMessage({ action: 'setVideoDownloaderEnabled', enabled: videoDownloaderEnabled }).catch(() => {});

  // Inform all tabs so content scripts can stop/start
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'setVideoDownloaderEnabled',
      enabled: videoDownloaderEnabled
    }).catch(() => {});
  });
}

async function initVideoDownloaderToggle() {
  const toggle = document.getElementById('videoDownloaderToggle');
  const stored = await chrome.storage.local.get('videoDownloaderEnabled');
  await setVideoDownloaderEnabled(stored.videoDownloaderEnabled !== false, { persist: false });

  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      await setVideoDownloaderEnabled(e.target.checked);
    });
  }
}

// Video Downloader functionality
const videoDownloaderConfig = {
  // Common video hosting platforms
  platforms: {
    youtube: {
      pattern: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
      name: 'YouTube',
      apiEndpoint: 'https://www.youtube.com/watch?v='
    },
    vimeo: {
      pattern: /vimeo\.com\/(\d+)/,
      name: 'Vimeo',
      apiEndpoint: 'https://vimeo.com/'
    },
    dailymotion: {
      pattern: /dailymotion\.com\/video\/([a-zA-Z0-9]+)/,
      name: 'Dailymotion',
      apiEndpoint: 'https://www.dailymotion.com/video/'
    }
  }
};

// Detect video platform from URL
function detectVideoPlatform(url) {
  for (const [key, platform] of Object.entries(videoDownloaderConfig.platforms)) {
    const match = url.match(platform.pattern);
    if (match) {
      return {
        platform: key,
        name: platform.name,
        videoId: match[1],
        url: url
      };
    }
  }
  return null;
}

// Detect videos on current tab
async function detectVideoOnPage() {
  const statusDiv = document.getElementById('videoStatus');
  const videoInfoDiv = document.getElementById('videoInfo');
  const videoInput = document.getElementById('videoUrl');
  if (!videoDownloaderEnabled) {
    statusDiv.textContent = 'Video downloader is disabled. Toggle it on first.';
    statusDiv.className = 'status warning';
    return;
  }
  
  try {
    statusDiv.textContent = '🔍 Scanning for videos...';
    statusDiv.className = 'status';
    videoInfoDiv.classList.add('hidden');
    
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Check if URL is a video platform
    const videoInfo = detectVideoPlatform(tab.url);
    
    if (videoInfo) {
      videoInput.value = tab.url;
      statusDiv.textContent = `✓ Found ${videoInfo.name} video!`;
      statusDiv.className = 'status success';
      
      // Show video info
      const videoTitleDiv = document.getElementById('videoTitle');
      videoTitleDiv.textContent = `${videoInfo.name} Video (ID: ${videoInfo.videoId})`;
      videoInfoDiv.classList.remove('hidden');
    } else {
      // Try to detect video elements on the page
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          const videos = document.querySelectorAll('video');
          const videoData = [];
          
          videos.forEach((video, index) => {
            videoData.push({
              src: video.src || video.currentSrc,
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration
            });
          });
          
          return videoData;
        }
      });
      
      if (results && results[0] && results[0].result && results[0].result.length > 0) {
        const videos = results[0].result.filter(v => v.src);
        
        if (videos.length > 0) {
          statusDiv.textContent = `✓ Found ${videos.length} video element(s) on page!`;
          statusDiv.className = 'status success';
          
          const videoTitleDiv = document.getElementById('videoTitle');
          videoTitleDiv.textContent = `${videos.length} video(s) detected`;
          
          const formatsDiv = document.getElementById('videoFormats');
          formatsDiv.innerHTML = videos.map((v, i) => 
            `<div class="format-item">Video ${i + 1}: ${v.width}x${v.height} - ${Math.round(v.duration)}s</div>`
          ).join('');
          
          videoInfoDiv.classList.remove('hidden');
          
          // Set first video URL to input
          if (videos[0].src) {
            videoInput.value = videos[0].src;
          }
        } else {
          statusDiv.textContent = '⚠ No videos detected on this page';
          statusDiv.className = 'status warning';
        }
      } else {
        statusDiv.textContent = '⚠ No videos detected on this page';
        statusDiv.className = 'status warning';
      }
    }
    
    setTimeout(() => {
      if (statusDiv.className !== 'status error') {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
      }
    }, 5000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
}

// Download video functionality
async function downloadVideo() {
  const statusDiv = document.getElementById('videoStatus');
  const videoInput = document.getElementById('videoUrl');
  const videoInfoDiv = document.getElementById('videoInfo');
  const url = videoInput.value.trim();
  if (!videoDownloaderEnabled) {
    statusDiv.textContent = 'Video downloader is disabled. Toggle it on first.';
    statusDiv.className = 'status warning';
    return;
  }
  
  if (!url) {
    statusDiv.textContent = '⚠ Please enter a video URL';
    statusDiv.className = 'status warning';
    return;
  }
  
  try {
    statusDiv.textContent = '📥 Preparing download...';
    statusDiv.className = 'status';
    videoInfoDiv.classList.add('hidden');
    
    // Check if it's a supported platform
    const videoInfo = detectVideoPlatform(url);
    
    if (videoInfo) {
      // Try to extract actual video URL from page
      statusDiv.textContent = '🔍 Searching for video sources...';
      statusDiv.className = 'status';
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Inject script to find video sources
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const videos = [];
            
            // Find all video elements
            document.querySelectorAll('video').forEach((video, idx) => {
              if (video.src) {
                videos.push({
                  type: 'direct',
                  src: video.src,
                  quality: `${video.videoWidth}x${video.videoHeight}`,
                  index: idx
                });
              }
              
              // Check source elements
              video.querySelectorAll('source').forEach(source => {
                if (source.src) {
                  videos.push({
                    type: 'source',
                    src: source.src,
                    quality: source.getAttribute('size') || 'unknown',
                    index: idx
                  });
                }
              });
            });
            
            // Try to find video URLs in network requests (stored in window)
            if (window.ytInitialPlayerResponse) {
              try {
                const playerData = window.ytInitialPlayerResponse;
                if (playerData.streamingData && playerData.streamingData.formats) {
                  playerData.streamingData.formats.forEach(format => {
                    if (format.url) {
                      videos.push({
                        type: 'youtube',
                        src: format.url,
                        quality: format.qualityLabel || format.quality,
                        index: -1
                      });
                    }
                  });
                }
              } catch (e) {}
            }
            
            return videos;
          }
        });
        
        const foundVideos = results && results[0] && results[0].result ? results[0].result : [];
        
        if (foundVideos.length > 0) {
          statusDiv.textContent = `✓ Found ${foundVideos.length} video source(s)!`;
          statusDiv.className = 'status success';
          
          const videoTitleDiv = document.getElementById('videoTitle');
          videoTitleDiv.textContent = `${videoInfo.name} - Found ${foundVideos.length} source(s)`;
          
          const formatsDiv = document.getElementById('videoFormats');
          formatsDiv.innerHTML = foundVideos.map((video, i) => `
            <button class="format-download-btn" data-video-src="${video.src}" style="
              width: 100%;
              padding: 10px;
              margin: 4px 0;
              background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 12px;
              font-weight: 600;
              transition: all 0.2s ease;
              text-align: left;
            ">
              📥 Download ${video.type} - ${video.quality}
            </button>
          `).join('');
          
          videoInfoDiv.classList.remove('hidden');
          
          // Add download handlers
          setTimeout(() => {
            document.querySelectorAll('.format-download-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                const videoSrc = btn.getAttribute('data-video-src');
                
                // Check if it's a blob URL
                if (videoSrc.startsWith('blob:')) {
                  statusDiv.textContent = '⏳ Downloading video (with audio if available)...';
                  statusDiv.className = 'status';
                  
                  try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    
                    console.log('Sending download request to content script:', videoSrc);
                    
                    // Send download request to content.js, which forwards to injected.js
                    const response = await chrome.tabs.sendMessage(tab.id, {
                      action: 'downloadBlob',
                      url: videoSrc
                    });
                    
                    console.log('Download response:', response);
                    
                    if (response && response.success) {
                      statusDiv.textContent = `✓ Downloaded: video with audio`;
                      statusDiv.className = 'status success';
                      
                      setTimeout(() => {
                        statusDiv.textContent = '';
                        statusDiv.className = 'status';
                      }, 3000);
                    } else {
                      throw new Error(response?.error || 'Download failed');
                    }
                  } catch (error) {
                    console.error('Blob download error:', error);
                    statusDiv.textContent = `✗ Error: ${error.message}`;
                    statusDiv.className = 'status error';
                  }
                  return;
                }
                
                statusDiv.textContent = '⬇️ Downloading video...';
                statusDiv.className = 'status';
                
                try {
                  // Get the active tab to inject download script
                  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                  
                  // Try to download using a content script
                  const downloadResult = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: async (videoUrl) => {
                      try {
                        // Fetch the video with page context
                        const response = await fetch(videoUrl, {
                          method: 'GET',
                          credentials: 'include'
                        });
                        
                        if (!response.ok) throw new Error('Failed to fetch video');
                        
                        // Get content type and size
                        const contentType = response.headers.get('content-type');
                        const contentLength = response.headers.get('content-length');
                        
                        // Read as blob
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        
                        // Determine file extension
                        let ext = '.mp4';
                        if (contentType) {
                          if (contentType.includes('webm')) ext = '.webm';
                          else if (contentType.includes('ogg')) ext = '.ogg';
                          else if (contentType.includes('quicktime')) ext = '.mov';
                        }
                        
                        // Create download link
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = `video_${Date.now()}${ext}`;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        
                        // Clean up
                        setTimeout(() => {
                          document.body.removeChild(a);
                          URL.revokeObjectURL(blobUrl);
                        }, 100);
                        
                        return { success: true, size: contentLength };
                      } catch (error) {
                        return { success: false, error: error.message };
                      }
                    },
                    args: [videoSrc]
                  });
                  
                  if (downloadResult && downloadResult[0] && downloadResult[0].result && downloadResult[0].result.success) {
                    statusDiv.textContent = '✓ Download started! Check your downloads folder.';
                    statusDiv.className = 'status success';
                    
                    setTimeout(() => {
                      statusDiv.textContent = '';
                      statusDiv.className = 'status';
                    }, 3000);
                  } else {
                    // Try direct download as fallback
                    try {
                      await chrome.downloads.download({
                        url: videoSrc,
                        saveAs: true
                      });
                      statusDiv.textContent = '✓ Download started!';
                      statusDiv.className = 'status success';
                    } catch (downloadErr) {
                      // Last resort: open in new tab
                      window.open(videoSrc, '_blank');
                      statusDiv.textContent = '✓ Video opened - right-click to save';
                      statusDiv.className = 'status success';
                    }
                  }
                  
                } catch (err) {
                  console.error('Download error:', err);
                  statusDiv.textContent = `✗ Download failed: Try "Detect Video" for other sources`;
                  statusDiv.className = 'status error';
                }
              });
              
              btn.addEventListener('mouseenter', function() {
                this.style.background = 'linear-gradient(135deg, #43a047 0%, #2e7d32 100%)';
                this.style.transform = 'translateY(-2px)';
              });
              btn.addEventListener('mouseleave', function() {
                this.style.background = 'linear-gradient(135deg, #66bb6a 0%, #43a047 100%)';
                this.style.transform = 'translateY(0)';
              });
            });
          }, 100);
          
        } else {
          statusDiv.textContent = `⚠ No direct video sources found for ${videoInfo.name}`;
          statusDiv.className = 'status warning';
          
          const videoTitleDiv = document.getElementById('videoTitle');
          videoTitleDiv.textContent = `${videoInfo.name} uses protected streaming`;
          
          const formatsDiv = document.getElementById('videoFormats');
          formatsDiv.innerHTML = `
            <div class="format-info" style="background: #fff3e0; padding: 12px; border-radius: 6px;">
              <p style="font-size: 12px; margin: 0 0 8px 0; font-weight: 600;">⚠ ${videoInfo.name} uses encrypted streaming</p>
              <p style="font-size: 11px; margin: 0;">This platform protects videos and requires specialized tools. Use yt-dlp or similar software to download.</p>
            </div>
          `;
          videoInfoDiv.classList.remove('hidden');
        }
        
      } catch (error) {
        console.error('Error extracting video:', error);
        statusDiv.textContent = `⚠ Could not extract video from ${videoInfo.name}`;
        statusDiv.className = 'status warning';
      }
      
      return;
      
    } else if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
      // Direct video URL - attempt multiple download methods
      statusDiv.textContent = '⬇️ Downloading...';
      statusDiv.className = 'status';
      
      let downloadSuccess = false;
      
      // Method 1: Try Chrome downloads API first
      try {
        await chrome.downloads.download({
          url: url,
          saveAs: true,
          conflictAction: 'uniquify'
        });
        
        statusDiv.textContent = '✓ Download started! Check your downloads.';
        statusDiv.className = 'status success';
        downloadSuccess = true;
        
      } catch (downloadError) {
        console.error('Chrome download failed:', downloadError);
        
        // Method 2: Try fetch and blob download
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: async (videoUrl) => {
              try {
                const response = await fetch(videoUrl, {
                  method: 'GET',
                  credentials: 'include',
                  mode: 'cors'
                });
                
                if (!response.ok) throw new Error('Fetch failed');
                
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                
                // Determine extension
                const contentType = response.headers.get('content-type') || '';
                let ext = '.mp4';
                if (contentType.includes('webm')) ext = '.webm';
                else if (contentType.includes('ogg')) ext = '.ogg';
                else if (contentType.includes('quicktime')) ext = '.mov';
                else if (videoUrl.includes('.webm')) ext = '.webm';
                
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `video_${Date.now()}${ext}`;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(blobUrl);
                }, 100);
                
                return { success: true };
              } catch (error) {
                return { success: false, error: error.message };
              }
            },
            args: [url]
          });
          
          if (result && result[0] && result[0].result && result[0].result.success) {
            statusDiv.textContent = '✓ Download started via fetch!';
            statusDiv.className = 'status success';
            downloadSuccess = true;
          }
        } catch (fetchError) {
          console.error('Fetch download failed:', fetchError);
        }
        
        // Method 3: Last resort - open in new tab
        if (!downloadSuccess) {
          window.open(url, '_blank');
          statusDiv.textContent = '✓ Video opened in new tab - right-click to save';
          statusDiv.className = 'status warning';
          downloadSuccess = true;
        }
      }
      
    } else {
      throw new Error('Invalid URL format. Please enter a valid video URL.');
    }
    
    setTimeout(() => {
      if (statusDiv.className === 'status success') {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
      }
    }, 5000);
    
  } catch (error) {
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
}

// Scan network for detected videos
async function scanNetworkForVideos() {
  const statusDiv = document.getElementById('videoStatus');
  const listDiv = document.getElementById('networkVideosList');
  if (!videoDownloaderEnabled) {
    statusDiv.textContent = 'Video downloader is disabled. Toggle it on first.';
    statusDiv.className = 'status warning';
    listDiv.classList.add('hidden');
    return;
  }
  
  try {
    statusDiv.textContent = '🔍 Scanning network traffic...';
    statusDiv.className = 'status';
    listDiv.classList.add('hidden');
    
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Request detected videos from background script
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        action: 'getDetectedVideos',
        tabId: tab.id
      });
    } catch (error) {
      console.error('Background script error:', error);
      throw new Error('Background script not responding. Try reloading the extension.');
    }
    
    if (!response) {
      throw new Error('No response from background script. Please reload the extension.');
    }
    
    let videos = response.videos || [];
    
      // Inject blob capture script directly into page context using world: 'MAIN'
    let blobVideos = [];
    try {
      console.log('Injecting blob capture script into page context...');
      
      // Inject script into MAIN world to bypass CSP
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          // Store actual blob objects so they can be downloaded later
          window.__videoBlobs = window.__videoBlobs || {};
          
          // Intercept URL.createObjectURL to store blob references
          const origCreateObjectURL = URL.createObjectURL;
          URL.createObjectURL = function(blob) {
            const url = origCreateObjectURL.apply(this, arguments);
            if (blob && blob.type && blob.type.startsWith('video/')) {
              // Store the actual blob object indexed by its URL
              window.__videoBlobs[url] = blob;
              console.log('Stored blob in __videoBlobs:', url, blob.size, 'bytes');
            }
            return url;
          };
          
          // Check existing video elements
          const blobs = [];
          document.querySelectorAll('video').forEach(video => {
            if (video.src && video.src.startsWith('blob:')) {
              blobs.push({
                url: video.src,
                type: 'video-element',
                timestamp: Date.now()
              });
            }
            video.querySelectorAll('source').forEach(source => {
              if (source.src && source.src.startsWith('blob:')) {
                blobs.push({
                  url: source.src,
                  type: 'source-element',
                  timestamp: Date.now()
                });
              }
            });
          });
          
          console.log('Found', blobs.length, 'blob videos in page');
          return blobs;
        }
      });
      
      if (injectionResults && injectionResults[0] && injectionResults[0].result) {
        blobVideos = injectionResults[0].result;
        console.log('Found', blobVideos.length, 'blob videos from page context');
      }
    } catch (blobError) {
      console.log('Could not scan for blob videos:', blobError);
    }
    
    // Merge network and blob videos
    if (blobVideos.length > 0) {
      const allVideos = [...videos, ...blobVideos];
      const seenUrls = new Set();
      videos = allVideos.filter(v => {
        if (seenUrls.has(v.url)) return false;
        seenUrls.add(v.url);
        return true;
      });
    }
    
    if (videos.length === 0) {
      statusDiv.textContent = '⚠ No videos detected yet. Play a video and try again.';
      statusDiv.className = 'status warning';
      
      listDiv.innerHTML = `
        <div class="format-info" style="background: #e3f2fd; padding: 12px; border-radius: 6px; margin-top: 10px;">
          <p style="font-size: 12px; margin: 0 0 8px 0; font-weight: 600;">💡 How to use Network Scanner:</p>
          <p style="font-size: 11px; margin: 0 0 4px 0;">1. Play a video on this page</p>
          <p style="font-size: 11px; margin: 0 0 4px 0;">2. Click "Scan Network for Videos"</p>
          <p style="font-size: 11px; margin: 0;">3. Download any detected video</p>
        </div>
      `;
      listDiv.classList.remove('hidden');
      return;
    }
    
    // Remove duplicates and sort by timestamp
    const uniqueVideos = [];
    const seenUrls = new Set();
    
    videos.sort((a, b) => b.timestamp - a.timestamp).forEach(video => {
      // Create a simplified URL for comparison (remove query params for duplication check)
      const baseUrl = video.url.split('?')[0];
      
      // Skip if already seen
      if (seenUrls.has(baseUrl)) return;
      
      // Skip HLS/DASH segments
      if (/seg-\d+-v\d+-a\d+\.ts$/i.test(baseUrl) || 
          /chunk-\d+\.ts$/i.test(baseUrl) ||
          /segment\d+\.ts$/i.test(baseUrl) ||
          (baseUrl.endsWith('.ts') && /\d+\.ts$/.test(baseUrl))) {
        return; // Skip streaming segments
      }
      
      seenUrls.add(baseUrl);
      uniqueVideos.push(video);
    });
    
    // Check if we have m3u8 playlists (HLS streams)
    const hasM3U8 = uniqueVideos.some(v => v.url.includes('.m3u8'));
    
    statusDiv.textContent = `✓ Found ${uniqueVideos.length} video(s)!`;
    statusDiv.className = 'status success';
    
    // Display videos
    listDiv.innerHTML = `
      <div style="margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 12px; font-weight: 600; color: #333;">Detected Videos:</span>
          <button id="clearNetworkVideos" style="
            padding: 4px 8px;
            font-size: 11px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          ">Clear List</button>
        </div>
        ${hasM3U8 ? `
          <div class="format-info" style="background: #e3f2fd; padding: 10px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid #2196f3;">
            <p style="font-size: 11px; margin: 0 0 6px 0; font-weight: 600; color: #1976d2;">ℹ️ HLS Stream Detected (.m3u8)</p>
            <p style="font-size: 10px; margin: 0 0 4px 0; color: #666;">This video uses HLS streaming. To download:</p>
            <p style="font-size: 10px; margin: 0 0 2px 0; color: #666;">• Use yt-dlp: <code style="background: #f5f5f5; padding: 2px 4px; border-radius: 3px;">yt-dlp [url]</code></p>
            <p style="font-size: 10px; margin: 0 0 2px 0; color: #666;">• Use FFmpeg to convert</p>
            <p style="font-size: 10px; margin: 0; color: #666;">• Use Video Download Helper extension</p>
          </div>
        ` : ''}
        ${uniqueVideos.map((video, i) => {
          const fileName = video.url.split('/').pop().split('?')[0] || 'video';
          const shortName = fileName.length > 40 ? fileName.substring(0, 37) + '...' : fileName;
          const isM3U8 = video.url.includes('.m3u8');
          const isDirectVideo = /\.(mp4|webm|ogg|mov|avi|mkv|flv)(\?|$)/i.test(video.url);
          
          return `
            <div class="network-video-item" style="
              padding: 8px;
              margin-bottom: 6px;
              background: white;
              border: 1px solid #e0e0e0;
              border-radius: 6px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 8px;
            ">
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 11px; font-weight: 600; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${video.url}">
                  ${isM3U8 ? '📺 ' : isDirectVideo ? '🎬 ' : ''}${shortName}
                </div>
                <div style="font-size: 10px; color: #999;">
                  ${video.type} • ${new Date(video.timestamp).toLocaleTimeString()}${isM3U8 ? ' • HLS Stream' : ''}
                </div>
              </div>
              ${isM3U8 ? `
                <button class="copy-url-btn" data-url="${video.url}" style="
                  padding: 6px 12px;
                  font-size: 11px;
                  background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-weight: 600;
                  white-space: nowrap;
                ">
                  📋 Copy URL
                </button>
              ` : `
                <button class="download-network-video" data-url="${video.url}" style="
                  padding: 6px 12px;
                  font-size: 11px;
                  background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-weight: 600;
                  white-space: nowrap;
                ">
                  ⬇️ Download
                </button>
              `}
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    listDiv.classList.remove('hidden');
    
    // Add copy URL handlers for m3u8 files
    document.querySelectorAll('.copy-url-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = btn.getAttribute('data-url');
        try {
          await navigator.clipboard.writeText(url);
          btn.textContent = '✓ Copied!';
          btn.style.background = '#4caf50';
          statusDiv.textContent = '✓ URL copied! Use with yt-dlp or similar tool.';
          statusDiv.className = 'status success';
          
          setTimeout(() => {
            btn.textContent = '📋 Copy URL';
            btn.style.background = 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)';
          }, 2000);
        } catch (err) {
          btn.textContent = '✗ Failed';
          btn.style.background = '#f44336';
        }
      });
    });
    
    // Add download handlers
    document.querySelectorAll('.download-network-video').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = btn.getAttribute('data-url');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Downloading...';
        btn.disabled = true;
        
        // Try multiple download methods
        let downloadSuccess = false;
        let lastError = null;
        
        // Method 1: Fetch in page context (best for CORS)
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          
          const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: async (videoUrl) => {
              try {
                // Fetch with all cookies and credentials
                const response = await fetch(videoUrl, {
                  method: 'GET',
                  credentials: 'include',
                  mode: 'cors',
                  cache: 'default',
                  referrerPolicy: 'no-referrer-when-downgrade'
                });
                
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                // Get file info
                const contentLength = response.headers.get('content-length');
                const contentType = response.headers.get('content-type') || '';
                
                // Read as blob
                const blob = await response.blob();
                
                if (blob.size === 0) {
                  throw new Error('Downloaded file is empty');
                }
                
                const blobUrl = URL.createObjectURL(blob);
                
                // Determine file extension
                let ext = '.mp4';
                if (contentType.includes('webm')) ext = '.webm';
                else if (contentType.includes('ogg')) ext = '.ogg';
                else if (contentType.includes('quicktime')) ext = '.mov';
                else if (contentType.includes('x-matroska')) ext = '.mkv';
                else if (videoUrl.toLowerCase().includes('.webm')) ext = '.webm';
                else if (videoUrl.toLowerCase().includes('.mov')) ext = '.mov';
                else if (videoUrl.toLowerCase().includes('.mkv')) ext = '.mkv';
                else if (videoUrl.toLowerCase().includes('.avi')) ext = '.avi';
                
                // Create download link
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `video_${Date.now()}${ext}`;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(blobUrl);
                }, 100);
                
                return { 
                  success: true, 
                  size: blob.size,
                  sizeText: (blob.size / (1024 * 1024)).toFixed(2) + ' MB'
                };
              } catch (error) {
                return { success: false, error: error.message };
              }
            },
            args: [url]
          });
          
          if (result && result[0] && result[0].result) {
            if (result[0].result.success) {
              downloadSuccess = true;
              btn.textContent = '✓ Downloaded!';
              btn.style.background = '#4caf50';
              statusDiv.textContent = `✓ Downloaded (${result[0].result.sizeText})`;
              statusDiv.className = 'status success';
            } else {
              lastError = result[0].result.error;
            }
          }
        } catch (err) {
          console.error('Fetch download failed:', err);
          lastError = err.message;
        }
        
        // Method 2: Chrome downloads API (if fetch failed)
        if (!downloadSuccess) {
          try {
            await chrome.downloads.download({
              url: url,
              saveAs: true,
              conflictAction: 'uniquify'
            });
            downloadSuccess = true;
            btn.textContent = '✓ Started!';
            btn.style.background = '#4caf50';
          } catch (err) {
            console.error('Chrome download failed:', err);
            lastError = err.message;
            lastError = err.message;
          }
        }
        
        // Method 3: Copy URL to clipboard (if all else fails)
        if (!downloadSuccess) {
          try {
            await navigator.clipboard.writeText(url);
            btn.textContent = '📋 URL Copied';
            btn.style.background = '#ff9800';
            statusDiv.textContent = `⚠ Download failed: ${lastError || 'Unknown error'}. URL copied - paste in browser or download manager.`;
            statusDiv.className = 'status warning';
            downloadSuccess = true;
          } catch (clipErr) {
            // Last resort: show URL in prompt
            btn.textContent = '✗ Failed';
            btn.style.background = '#f44336';
            
            statusDiv.innerHTML = `
              <div style="text-align: left; font-size: 11px;">
                <strong>⚠ Download Failed</strong><br>
                Error: ${lastError || 'Unknown error'}<br>
                <strong>Solutions:</strong><br>
                • Right-click video and "Save as"<br>
                • Use external downloader (yt-dlp, IDM)<br>
                • Copy URL manually: <input type="text" value="${url}" readonly style="width: 100%; font-size: 10px; margin-top: 4px;" onclick="this.select()">
              </div>
            `;
            statusDiv.className = 'status error';
          }
        }
        
        // Reset button after delay
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = 'linear-gradient(135deg, #66bb6a 0%, #43a047 100%)';
          btn.disabled = false;
        }, 3000);
      });
    });
    
    // Clear list handler
    document.getElementById('clearNetworkVideos')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        action: 'clearDetectedVideos',
        tabId: tab.id
      });
      listDiv.classList.add('hidden');
      statusDiv.textContent = '✓ List cleared';
      statusDiv.className = 'status success';
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
      }, 2000);
    });
    
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = 'status';
    }, 3000);
    
  } catch (error) {
    console.error('Network scan error:', error);
    statusDiv.textContent = `✗ Error: ${error.message}`;
    statusDiv.className = 'status error';
  }
}

// Event listeners for video downloader
document.getElementById('scanNetworkVideos').addEventListener('click', scanNetworkForVideos);
document.getElementById('detectVideo').addEventListener('click', detectVideoOnPage);
document.getElementById('downloadVideo').addEventListener('click', downloadVideo);

// Allow Enter key to trigger download
document.getElementById('videoUrl').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    downloadVideo();
  }
});

// Initialize toggle state on popup open
initVideoDownloaderToggle();
// Tracker blocking feature
async function loadTrackerBlockList() {
  const data = await chrome.storage.local.get('trackerBlockList');
  const trackerList = data.trackerBlockList || '';
  document.getElementById('trackerBlockList').value = trackerList;
}

document.getElementById('saveTrackerList').addEventListener('click', async () => {
  const trackerList = document.getElementById('trackerBlockList').value;
  const trackers = trackerList
    .split('\n')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
  
  await chrome.storage.local.set({ trackerBlockList: trackerList });
  
  // Send to content scripts to activate blocking
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateTrackerBlockList',
      trackers: trackers
    }).catch(() => {}); // Ignore errors for non-accessible tabs
  });
  
  const statusDiv = document.getElementById('trackerSaveStatus');
  statusDiv.textContent = `✓ Saved ${trackers.length} tracker(s) to block`;
  statusDiv.className = 'status success';
  setTimeout(() => {
    statusDiv.textContent = '';
  }, 3000);
});

// Load tracker list on popup open
loadTrackerBlockList();