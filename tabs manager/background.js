// Background service worker for video detection
let detectedVideos = {};
let videoDownloaderEnabled = true;

// Load persisted toggle state
chrome.storage.local.get('videoDownloaderEnabled', (data) => {
  videoDownloaderEnabled = data.videoDownloaderEnabled !== false;
});

// React to toggle changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.videoDownloaderEnabled) {
    videoDownloaderEnabled = changes.videoDownloaderEnabled.newValue !== false;
  }
});

// Video file extensions and MIME types to detect
const VIDEO_PATTERNS = {
  extensions: ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.m4v', '.3gp', '.wmv', '.m3u8'],
  mimeTypes: ['video/', 'application/x-mpegURL', 'application/vnd.apple.mpegurl'],
  // Patterns to exclude (streaming segments)
  excludePatterns: [
    /seg-\d+-v\d+-a\d+\.ts$/i,  // HLS segments like seg-6-v1-a1.ts
    /chunk-\d+\.ts$/i,           // chunk segments
    /segment\d+\.ts$/i,          // numbered segments
    /-\d+\.ts$/i,                // generic numbered .ts files
    /\.ts\?/,                    // .ts with query params (usually segments)
  ]
};

console.log('Video Downloader background script loaded');

// Listen for web requests to detect video files
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!videoDownloaderEnabled) return;
    try {
      const url = details.url;
      const tabId = details.tabId;
      
      // Skip if no valid tab
      if (tabId === -1) return;
      
      // Check for exclude patterns (streaming segments)
      const isExcluded = VIDEO_PATTERNS.excludePatterns.some(pattern => pattern.test(url));
      if (isExcluded) {
        return; // Skip HLS/DASH segments
      }
      
      // Check if URL matches video patterns
      const isVideo = VIDEO_PATTERNS.extensions.some(ext => url.toLowerCase().includes(ext)) ||
                      url.includes('video') ||
                      url.includes('.m3u8') ||
                      url.includes('stream');
      
      if (isVideo && !url.includes('blob:') && !url.includes('data:')) {
        // Store detected video
        if (!detectedVideos[tabId]) {
          detectedVideos[tabId] = [];
        }
        
        // Avoid duplicates
        if (!detectedVideos[tabId].some(v => v.url === url)) {
          detectedVideos[tabId].push({
            url: url,
            timestamp: Date.now(),
            type: 'network'
          });
          
          console.log(`Video detected on tab ${tabId}:`, url);
          
          // Keep only last 50 videos per tab
          if (detectedVideos[tabId].length > 50) {
            detectedVideos[tabId] = detectedVideos[tabId].slice(-50);
          }
        }
      }
    } catch (error) {
      console.error('Error in onBeforeRequest:', error);
    }
  },
  { urls: ["<all_urls>"] }
);

// Also check response headers for video content
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!videoDownloaderEnabled) return;
    try {
      const tabId = details.tabId;
      if (tabId === -1) return;
      
      const contentType = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-type'
      )?.value?.toLowerCase();
      
      if (contentType && VIDEO_PATTERNS.mimeTypes.some(type => contentType.includes(type))) {
        if (!detectedVideos[tabId]) {
          detectedVideos[tabId] = [];
        }
        
        if (!detectedVideos[tabId].some(v => v.url === details.url)) {
          detectedVideos[tabId].push({
            url: details.url,
            timestamp: Date.now(),
            type: 'header',
            contentType: contentType
          });
          
          console.log(`Video detected via header on tab ${tabId}:`, details.url);
          
          if (detectedVideos[tabId].length > 50) {
            detectedVideos[tabId] = detectedVideos[tabId].slice(-50);
          }
        }
      }
    } catch (error) {
      console.error('Error in onHeadersReceived:', error);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedVideos[tabId];
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received:', request);
  
  try {
    if (request.action === 'setVideoDownloaderEnabled') {
      videoDownloaderEnabled = request.enabled !== false;
      sendResponse({ success: true, enabled: videoDownloaderEnabled });
    } else if (request.action === 'getDetectedVideos') {
      if (!videoDownloaderEnabled) {
        sendResponse({ videos: [], disabled: true });
        return true;
      }
      const tabId = request.tabId;
      const videos = detectedVideos[tabId] || [];
      console.log(`Sending ${videos.length} videos for tab ${tabId}`);
      sendResponse({ videos: videos });
    } else if (request.action === 'clearDetectedVideos') {
      if (!videoDownloaderEnabled) {
        sendResponse({ success: true, disabled: true });
        return true;
      }
      const tabId = request.tabId;
      detectedVideos[tabId] = [];
      console.log(`Cleared videos for tab ${tabId}`);
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ error: error.message });
  }
  
  return true; // Keep channel open for async response
});

// Clean up old videos periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  for (const tabId in detectedVideos) {
    detectedVideos[tabId] = detectedVideos[tabId].filter(
      v => (now - v.timestamp) < maxAge
    );
    
    if (detectedVideos[tabId].length === 0) {
      delete detectedVideos[tabId];
    }
  }
}, 5 * 60 * 1000);
