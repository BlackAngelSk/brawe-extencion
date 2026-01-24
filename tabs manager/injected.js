// This script runs in the PAGE context and has full access to page objects
// Only initialize once to avoid duplicate declaration errors
if (!window.__videoBlobsInitialized) {
  window.__videoBlobsInitialized = true;
  console.log('Initializing blob capture system...');
  
  // Store actual blob objects
  window.__videoBlobs = window.__videoBlobs || {};
  // Capture MediaSource chunks so we can reconstruct a Blob for MSE streams (e.g., YouTube)
  // Structure: __mseCaptures[mseId] = { sources: { sourceId: { mimeType, buffers[], totalBytes } } }
  window.__mseCaptures = window.__mseCaptures || {};
  window.__mseUrlToId = window.__mseUrlToId || {};
  window.__ffmpegLoader = window.__ffmpegLoader || null;
  window.__ffmpegInstance = window.__ffmpegInstance || null;
  window.__trackerBlockList = window.__trackerBlockList || []; // List of tracker names to block
  const detectedBlobs = [];

  // Tracker blocking: intercept script creation
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(document, tagName);
    
    if (tagName.toLowerCase() === 'script') {
      const handler = {
        set(target, prop, value) {
          if (prop === 'src' && typeof value === 'string') {
            // Check if this script URL contains any blocked tracker names
            const trackerMatch = window.__trackerBlockList.some(tracker => 
              value.toLowerCase().includes(tracker.toLowerCase())
            );
            
            if (trackerMatch) {
              console.warn('[TRACKER BLOCKED]', value);
              return true; // Block the assignment
            }
          }
          target[prop] = value;
          return true;
        }
      };
      
      return new Proxy(element, handler);
    }
    
    return element;
  };
  
  // Also block fetch/XMLHttpRequest to tracking endpoints
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    if (typeof url === 'string') {
      const trackerMatch = window.__trackerBlockList.some(tracker =>
        url.toLowerCase().includes(tracker.toLowerCase())
      );
      if (trackerMatch) {
        console.warn('[TRACKER BLOCKED]', url);
        return Promise.reject(new Error('Tracker blocked: ' + url));
      }
    }
    return origFetch.apply(this, args);
  };

  // Helper: rebuild blob from captured MSE buffers (choose best track)
  function pickBestSource(capture) {
    if (!capture || !capture.sources) return null;
    const sources = Object.values(capture.sources);
    if (!sources.length) return null;
    const video = sources.find(s => s.mimeType && s.mimeType.startsWith('video/'));
    if (video) return video;
    return sources.reduce((a, b) => (b.totalBytes > (a?.totalBytes || 0) ? b : a), null);
  }

  function reconstructBlobFromMSE(url) {
    if (!window.__mseUrlToId || !window.__mseCaptures || !window.__mseUrlToId[url]) return null;
    const mseId = window.__mseUrlToId[url];
    const capture = window.__mseCaptures[mseId];
    const source = pickBestSource(capture);
    if (!source || !source.buffers || !source.buffers.length) return null;
    const mime = source.mimeType || 'video/webm';
    try {
      const blob = new Blob(source.buffers, { type: mime });
      window.__videoBlobs[url] = blob;
      // Also map this reconstructed blob URL back to the mseId so audio lookup works when download uses this URL
      window.__mseUrlToId[url] = mseId;
      console.log('✓ Reconstructed blob from MSE:', url.substring(0, 60) + '...', 'size:', blob.size, 'type:', blob.type);
      return blob;
    } catch (e) {
      console.warn('MSE reconstruction failed:', e.message);
      return null;
    }
  }

  // Helper: rebuild audio-only blob when available
  function pickAudioSource(capture) {
    if (!capture || !capture.sources) return null;
    const sources = Object.values(capture.sources);
    if (!sources.length) return null;
    const audio = sources.find(s => s.mimeType && s.mimeType.startsWith('audio/'));
    return audio || null;
  }

  function reconstructAudioBlobFromMSE(url) {
    if (!window.__mseUrlToId || !window.__mseCaptures) return null;
    // url might be the original MediaSource URL or a reconstructed blob URL we mapped back to the same mseId
    const mseId = window.__mseUrlToId[url];
    if (!mseId) return null;
    const capture = window.__mseCaptures[mseId];
    const source = pickAudioSource(capture);
    if (!source || !source.buffers || !source.buffers.length) return null;
    const mime = source.mimeType || 'audio/webm';
    try {
      const blob = new Blob(source.buffers, { type: mime });
      const audioKey = url + '#audio';
      window.__videoBlobs[audioKey] = blob;
      console.log('✓ Reconstructed audio blob from MSE:', audioKey.substring(0, 60) + '...', 'size:', blob.size, 'type:', blob.type);
      return { blob, key: audioKey };
    } catch (e) {
      console.warn('MSE audio reconstruction failed:', e.message);
      return null;
    }
  }

  // Lazy-load ffmpeg.wasm from CDN for in-browser muxing
  async function loadFFmpeg() {
    if (window.__ffmpegLoader) return window.__ffmpegLoader;
    window.__ffmpegLoader = new Promise(async (resolve, reject) => {
      try {
        if (!window.createFFmpeg) {
          const script = document.createElement('script');
          const cdnUrl = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/ffmpeg.min.js';
          
          // Handle Trusted Types for YouTube's strict CSP
          try {
            if (window.trustedTypes) {
              let policy = trustedTypes.defaultPolicy;
              if (!policy) {
                // Try to create or get existing policy
                try {
                  policy = trustedTypes.createPolicy('ffmpeg-ext-loader', {
                    createScriptURL: (url) => url
                  });
                } catch (e) {
                  // Policy might already exist, try to get it
                  console.log('[FFMPEG] Policy creation failed, trying direct assignment:', e.message);
                }
              }
              if (policy) {
                script.src = policy.createScriptURL(cdnUrl);
                console.log('[FFMPEG] Using Trusted Types policy');
              } else {
                // Last resort: assign directly (will fail on strict CSP)
                script.src = cdnUrl;
                console.warn('[FFMPEG] No policy available, direct assignment (may fail)');
              }
            } else {
              script.src = cdnUrl;
            }
          } catch (ttError) {
            console.error('[FFMPEG] Trusted Types error:', ttError);
            reject(new Error('Trusted Types violation: ' + ttError.message));
            return;
          }
          
          script.onload = () => {
            console.log('[FFMPEG] ✓ Script loaded successfully');
            resolve();
          };
          script.onerror = () => reject(new Error('Failed to load ffmpeg.wasm from CDN'));
          document.documentElement.appendChild(script);
        } else {
          resolve();
        }
      } catch (e) {
        console.error('[FFMPEG] Load error:', e);
        reject(e);
      }
    });
    return window.__ffmpegLoader;
  }

  async function getFFmpeg() {
    await loadFFmpeg();
    if (window.__ffmpegInstance) return window.__ffmpegInstance;
    if (!window.createFFmpeg) throw new Error('ffmpeg loader not present');
    const ffmpeg = window.createFFmpeg({ log: false, corePath: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/ffmpeg-core.js' });
    await ffmpeg.load();
    window.__ffmpegInstance = ffmpeg;
    return ffmpeg;
  }

  async function muxToMkv(videoBlob, audioBlob) {
    try {
      console.log('muxToMkv: Loading ffmpeg...');
      const ffmpeg = await getFFmpeg();
      console.log('muxToMkv: Converting to arrays...');
      const videoData = new Uint8Array(await videoBlob.arrayBuffer());
      const audioData = new Uint8Array(await audioBlob.arrayBuffer());
      console.log('muxToMkv: Writing files to ffmpeg FS...');
      ffmpeg.FS('writeFile', 'v.mp4', videoData);
      ffmpeg.FS('writeFile', 'a.webm', audioData);
      console.log('muxToMkv: Running ffmpeg command...');
      await ffmpeg.run('-i', 'v.mp4', '-i', 'a.webm', '-c', 'copy', '-map', '0:v:0', '-map', '1:a:0', 'out.mkv');
      console.log('muxToMkv: Reading output...');
      const out = ffmpeg.FS('readFile', 'out.mkv');
      ffmpeg.FS('unlink', 'v.mp4');
      ffmpeg.FS('unlink', 'a.webm');
      ffmpeg.FS('unlink', 'out.mkv');
      console.log('muxToMkv: Success, output size:', out.buffer.byteLength);
      return new Blob([out.buffer], { type: 'video/x-matroska' });
    } catch (e) {
      console.error('Mux failed:', e.message, e.stack);
      return null;
    }
  }

  function logSourcesFor(url) {
    const mseId = window.__mseUrlToId && window.__mseUrlToId[url];
    const capture = mseId && window.__mseCaptures && window.__mseCaptures[mseId];
    if (!capture || !capture.sources) {
      console.log('No capture sources for', url);
      return;
    }
    console.log('Captured sources for', url, '->', Object.entries(capture.sources).map(([id, s]) => ({ id, mime: s.mimeType, buffers: s.buffers.length, bytes: s.totalBytes })));
  }

  // Clone buffer data so neutering/transfer by appendBuffer doesn't erase our capture
  function cloneBufferData(buffer) {
    if (buffer instanceof ArrayBuffer) {
      const copy = new Uint8Array(buffer.byteLength);
      copy.set(new Uint8Array(buffer));
      return copy;
    }
    if (ArrayBuffer.isView(buffer)) {
      const view = buffer;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return copy;
    }
    return null;
  }
  
  // Intercept MediaSource to capture appended buffers
  if (typeof MediaSource !== 'undefined') {
    const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function(mimeType) {
      const sb = origAddSourceBuffer.apply(this, arguments);
      try {
        const ms = this;
        if (!ms.__mseId) {
          ms.__mseId = 'ms_' + Date.now() + '_' + Math.random().toString(36).slice(2);
          window.__mseCaptures[ms.__mseId] = { sources: {} };
        }
        const capture = window.__mseCaptures[ms.__mseId];
        const sourceId = 'sb_' + Object.keys(capture.sources).length + '_' + Math.random().toString(36).slice(2);
        capture.sources[sourceId] = capture.sources[sourceId] || { mimeType, buffers: [], totalBytes: 0 };
        const sbCapture = capture.sources[sourceId];
        const origAppend = sb.appendBuffer;
        sb.appendBuffer = function(buffer) {
          try {
            const copy = cloneBufferData(buffer);
            if (copy) {
              sbCapture.buffers.push(copy);
              sbCapture.totalBytes += copy.byteLength;
              if (sbCapture.buffers.length % 20 === 0) {
                console.log('MSE capture', ms.__mseId, 'track:', sbCapture.mimeType, 'buffers:', sbCapture.buffers.length, 'bytes:', sbCapture.totalBytes);
              }
            }
          } catch (e) {
            console.warn('MSE append capture failed:', e.message);
          }
          return origAppend.apply(this, arguments);
        };
      } catch (e) {
        console.warn('MSE hook failed:', e.message);
      }
      return sb;
    };
  }

  // Intercept URL.createObjectURL to capture blobs and MediaSources
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(blob) {
    const url = origCreateObjectURL.apply(this, arguments);
    
    // Store MediaSource mapping (ensure id exists even before addSourceBuffer runs)
    if (typeof MediaSource !== 'undefined' && blob instanceof MediaSource) {
      if (!blob.__mseId) {
        blob.__mseId = 'ms_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      }
      if (!window.__mseCaptures[blob.__mseId]) {
        window.__mseCaptures[blob.__mseId] = { sources: {} };
      }
      window.__mseUrlToId[url] = blob.__mseId;
      console.log('✓ MediaSource URL mapped:', url.substring(0, 60) + '...', 'id:', blob.__mseId);
    }

    // Store blob if it's a valid object with size
    if (blob && typeof blob === 'object' && blob.size !== undefined) {
      window.__videoBlobs[url] = blob;
      console.log('✓ Blob captured:', url.substring(0, 60) + '...', 'Size:', blob.size, 'bytes', 'Type:', blob.type);
      
      // Track video blobs
      if (blob.type && blob.type.startsWith('video/')) {
        detectedBlobs.push({
          url: url,
          type: 'blob-video',
          size: blob.size,
          mimeType: blob.type,
          timestamp: Date.now()
        });
      }
    }
    return url;
  };

  // Intercept fetch for blob: URLs so popup/content can fetch reconstructed blobs
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = async function(resource, init) {
      try {
        const url = typeof resource === 'string' ? resource : (resource && resource.url);
        if (url && typeof url === 'string' && url.startsWith('blob:')) {
          let blob = window.__videoBlobs[url];
          if (!blob) {
            blob = reconstructBlobFromMSE(url);
          }
          if (blob) {
            return new Response(blob, { status: 200, statusText: 'OK' });
          }
        }
      } catch (e) {
        console.warn('blob fetch shim failed:', e.message);
      }
      return origFetch.apply(this, arguments);
    };
  }

  // Monitor video elements
  function scanVideos() {
    document.querySelectorAll('video').forEach(video => {
      if (video.src && video.src.startsWith('blob:')) {
        if (!detectedBlobs.some(b => b.url === video.src)) {
          detectedBlobs.push({
            url: video.src,
            type: 'video-element',
            timestamp: Date.now()
          });
        }
      }
      video.querySelectorAll('source').forEach(source => {
        if (source.src && source.src.startsWith('blob:')) {
          if (!detectedBlobs.some(b => b.url === source.src)) {
            detectedBlobs.push({
              url: source.src,
              type: 'source-element',
              timestamp: Date.now()
            });
          }
        }
      });
    });
  }

  scanVideos();
  setInterval(scanVideos, 1000);

  // Attach MutationObserver when body is ready
  function attachObserver() {
    if (document.body) {
      new MutationObserver(scanVideos).observe(document.body, { subtree: true, childList: true });
      console.log('Mutation observer attached');
    } else {
      setTimeout(attachObserver, 100);
    }
  }
  attachObserver();

  // Listen for download requests
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'DOWNLOAD_BLOB') {
      const blobUrl = event.data.url;
      console.log('Download request for:', blobUrl);
      console.log('Blobs in storage:', Object.keys(window.__videoBlobs).length);
      
      try {
        let blob = window.__videoBlobs[blobUrl];

        // Fallback: if not a Blob, try reconstructing from MediaSource capture
        if (!blob) {
          blob = reconstructBlobFromMSE(blobUrl);
        }

        logSourcesFor(blobUrl);

        if (!blob) {
          console.error('❌ Blob not found in storage for:', blobUrl);
          throw new Error('Blob not found in storage');
        }
        
        console.log('✓ Found blob in storage:', blob.size, 'bytes', blob.type);
        console.log('Checking for audio track...');
        
        // Check for audio BEFORE downloading video
        console.log('Calling reconstructAudioBlobFromMSE with:', blobUrl);
        const audioRebuild = reconstructAudioBlobFromMSE(blobUrl);
        console.log('reconstructAudioBlobFromMSE returned:', audioRebuild);
        
        if (audioRebuild && audioRebuild.blob) {
          const audioBlob = audioRebuild.blob;
          console.log('✓ Audio track available:', audioBlob.type, audioBlob.size, 'bytes');
          console.log('NOTE: In-browser muxing blocked by YouTube CSP. Downloading separate video + audio files.');
          console.log('To combine: Use free tools like ffmpeg, VLC, HandBrake, or online video mergers.');
          
          // Download video + audio separately (muxing blocked by CSP)
          console.log('Downloading video separately...');
          const videoUrl = URL.createObjectURL(blob);
          const videoLink = document.createElement('a');
          videoLink.href = videoUrl;
          let videoExt = '.mp4';
          if (blob.type && blob.type.includes('webm')) videoExt = '.webm';
          else if (blob.type && blob.type.includes('ogg')) videoExt = '.ogg';
          videoLink.download = 'video_' + Date.now() + videoExt;
          document.body.appendChild(videoLink);
          videoLink.click();
          setTimeout(() => {
            videoLink.remove();
            URL.revokeObjectURL(videoUrl);
          }, 500);
          console.log('✓ Video download triggered:', videoLink.download);
          
          console.log('Downloading audio separately...');
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioLink = document.createElement('a');
          audioLink.href = audioUrl;
          let audioExt = '.webm';
          if (audioBlob.type && audioBlob.type.includes('mp4')) audioExt = '.m4a';
          else if (audioBlob.type && audioBlob.type.includes('ogg')) audioExt = '.ogg';
          audioLink.download = 'audio_' + Date.now() + audioExt;
          document.body.appendChild(audioLink);
          setTimeout(() => {
            audioLink.click();
            setTimeout(() => {
              audioLink.remove();
              URL.revokeObjectURL(audioUrl);
            }, 500);
          }, 300);
          console.log('✓ Audio download triggered:', audioLink.download, 'mime:', audioBlob.type, 'size:', audioBlob.size);
        } else {
          // No audio, just download video
          console.warn('No audio track found for', blobUrl, '- downloading video only');
          const downloadUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = downloadUrl;
          let ext = '.mp4';
          if (blob.type && blob.type.includes('webm')) ext = '.webm';
          else if (blob.type && blob.type.includes('ogg')) ext = '.ogg';
          link.download = 'video_' + Date.now() + ext;
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            link.remove();
            URL.revokeObjectURL(downloadUrl);
          }, 500);
          console.log('✓ Video-only download triggered:', link.download);
        }
        
        // Send success response
        window.postMessage({ type: 'DOWNLOAD_RESULT', result: { success: true } }, '*');
      } catch(e) {
        console.error('❌ Download failed:', e.message);
        window.postMessage({ type: 'DOWNLOAD_RESULT', result: { success: false, error: e.message } }, '*');
      }
    }
    else if (event.data.type === 'UPDATE_TRACKER_BLOCK_LIST') {
      // Update the list of trackers to block
      window.__trackerBlockList = event.data.trackers || [];
      console.log('[TRACKER BLOCKER] Updated block list:', window.__trackerBlockList);
    }
  });
  
  console.log('✓ Blob capture system ready');
}