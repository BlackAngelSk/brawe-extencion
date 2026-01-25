// Content script - runs in isolated world
console.log('Content script started');

// Store blobs received from page context
let detectedBlobs = [];
let videoDownloaderEnabled = true;
let injectionAttempted = false;

// Listen for messages from the injected script (page context)
window.addEventListener('message', (event) => {
  if (!videoDownloaderEnabled) return;
  if (event.source !== window) return;
  
  if (event.data.type === 'BLOB_DETECTED') {
    detectedBlobs.push(event.data.blob);
    console.log('Blob received from page:', event.data.blob.url);
  } else if (event.data.type === 'BLOBS_LIST') {
    detectedBlobs = event.data.blobs;
    console.log('Received', detectedBlobs.length, 'blobs from page');
  } else if (event.data.type === 'DOWNLOAD_RESULT') {
    // Store for retrieval by message handler
    window.__lastDownloadResult = event.data.result;
  } else if (event.data.type === 'DOWNLOAD_VIDEO_URL') {
    // Handle direct URL download via chrome downloads API
    console.log('Download request for URL:', event.data.url, 'as', event.data.filename);
    chrome.downloads.download({
      url: event.data.url,
      filename: 'Videos/' + event.data.filename,
      saveAs: false
    }, (downloadId) => {
      console.log('Download started with ID:', downloadId);
    });
  }
});

// Try to inject script into main world
function injectScript() {
  if (injectionAttempted || !videoDownloaderEnabled) return;
  injectionAttempted = true;
  try {
    // First, inject blob interception ASAP (inline)
    const blobScript = document.createElement('script');
    blobScript.textContent = `
      console.log('Injecting blob interception...');
      
      // Store actual blob objects so they can be downloaded later
      window.__videoBlobs = window.__videoBlobs || {};
      
      // Intercept URL.createObjectURL to store blob references
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function(blob) {
        const url = origCreateObjectURL.apply(this, arguments);
        if (blob && blob.type && blob.type.startsWith('video/')) {
          // Store the actual blob object indexed by its URL
          window.__videoBlobs[url] = blob;
          console.log('✓ Blob intercepted and stored:', url, blob.size, 'bytes', blob.type);
        }
        return url;
      };
      
      console.log('Blob interception ready - waiting for videos...');
    `;
    
    (document.head || document.documentElement).appendChild(blobScript);
    blobScript.remove();
    console.log('Blob interception injected');
    
    // Then try to load full injected script (for scanner functionality)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      console.log('✓ Injected script loaded successfully');
      this.remove();
    };
    script.onerror = function() {
      console.warn('⚠ Injected script failed to load (CSP blocked)');
    };
    
    (document.head || document.documentElement).appendChild(script);
    console.log('Script tag created with src:', script.src);
  } catch (error) {
    console.error('Injection error:', error);
  }
}

// Handle toggle state and late injection
function setVideoDownloaderState(enabled) {
  videoDownloaderEnabled = enabled;

  if (videoDownloaderEnabled && !injectionAttempted) {
    injectScript();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectScript, { once: true });
    }
  }

  if (!videoDownloaderEnabled) {
    detectedBlobs = [];
  }

  // Notify page context so injected script can pause/resume capture
  try {
    window.postMessage({ type: 'SET_VIDEO_DOWNLOADER_ENABLED', enabled: videoDownloaderEnabled }, '*');
  } catch (e) {
    console.warn('Failed to post toggle state to page:', e.message);
  }
}

chrome.storage.local.get('videoDownloaderEnabled', (data) => {
  setVideoDownloaderState(data.videoDownloaderEnabled !== false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.videoDownloaderEnabled) {
    setVideoDownloaderState(changes.videoDownloaderEnabled.newValue !== false);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received:', request.action);
  
  if (request.action === 'setVideoDownloaderEnabled') {
    setVideoDownloaderState(request.enabled !== false);
    sendResponse({ success: true, enabled: videoDownloaderEnabled });
    return true;
  }

  if (!videoDownloaderEnabled && ['getBlobVideos', 'downloadBlob', 'clearBlobs'].includes(request.action)) {
    sendResponse({ success: false, error: 'Video downloader is disabled' });
    return true;
  }
  
  if (request.action === 'getBlobVideos') {
    // Request fresh list from page context
    console.log('Requesting blob list from page...');
    window.postMessage({ type: 'GET_BLOBS' }, '*');
    
    // Wait for response
    setTimeout(() => {
      console.log('Sending', detectedBlobs.length, 'blobs to popup');
      sendResponse({ videos: detectedBlobs });
    }, 100);
  } 
  else if (request.action === 'downloadBlob') {
    // Clear any previous result
    delete window.__lastDownloadResult;
    
    // Request download from page context
    console.log('>>> Sending download request to page for:', request.url);
    window.postMessage({ type: 'DOWNLOAD_BLOB', url: request.url }, '*');
    
    // Wait for result with timeout
    let attempts = 0;
    const maxAttempts = 100; // 5 seconds max
    
    const checkResult = () => {
      if (window.__lastDownloadResult) {
        const result = window.__lastDownloadResult;
        delete window.__lastDownloadResult;
        console.log('>>> Download result received:', result);
        sendResponse(result);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(checkResult, 50);
      } else {
        console.error('>>> Download timeout - no response from page');
        sendResponse({ success: false, error: 'Download timeout - injected script may not be loaded' });
      }
    };
    
    setTimeout(checkResult, 100);
  }
  else if (request.action === 'clearBlobs') {
    window.postMessage({ type: 'CLEAR_BLOBS' }, '*');
    detectedBlobs = [];
    sendResponse({ success: true });
  }
  else if (request.action === 'updateTrackerBlockList') {
    // Send tracker list to page context
    window.postMessage({
      type: 'UPDATE_TRACKER_BLOCK_LIST',
      trackers: request.trackers
    }, '*');
    sendResponse({ success: true });
  }
  
  return true;
});
