import { Dropbox } from 'dropbox';

const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = import.meta.env.VITE_DROPBOX_APP_SECRET;
const DROPBOX_REFRESH_TOKEN = import.meta.env.VITE_DROPBOX_REFRESH_TOKEN;
const BASE_PATH = '/polar-questions-data';

// Store current access token in memory
let currentAccessToken = null;
let tokenExpiry = null;

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken() {
  if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) {
    throw new Error('Dropbox OAuth credentials not configured. Please add VITE_DROPBOX_APP_KEY, VITE_DROPBOX_APP_SECRET, and VITE_DROPBOX_REFRESH_TOKEN to your .env file');
  }

  try {
    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const data = await response.json();
    currentAccessToken = data.access_token;
    // Tokens typically expire in 4 hours, refresh 5 minutes before
    tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    
    return currentAccessToken;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getAccessToken() {
  // If token doesn't exist or is about to expire, refresh it
  if (!currentAccessToken || !tokenExpiry || Date.now() >= tokenExpiry) {
    await refreshAccessToken();
  }
  return currentAccessToken;
}

/**
 * Initialize Dropbox client with current access token
 */
async function getDropboxClient() {
  const accessToken = await getAccessToken();
  return new Dropbox({ accessToken });
}

/**
 * Upload video file to Dropbox using chunked upload for large files
 * @param {Blob} videoBlob - Video file
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<string>} Path to uploaded file
 */
export async function uploadVideo(videoBlob, sessionId) {
  const dbx = await getDropboxClient();
  const sessionPath = `${BASE_PATH}/${sessionId}`;
  const path = `${sessionPath}/video.mp4`;
  
  // Chunk size: 4MB (Dropbox API recommends chunks between 4MB and 8MB)
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB in bytes
  const MAX_SIMPLE_UPLOAD_SIZE = 150 * 1024 * 1024; // 150MB - Dropbox's limit for simple uploads
  
  try {
    // Ensure base folder exists
    try {
      await dbx.filesCreateFolderV2({ path: BASE_PATH });
    } catch (error) {
      // Folder might already exist, ignore conflict error
      if (error.error?.error?.['.tag'] !== 'path' || error.error?.error?.path?.['.tag'] !== 'conflict') {
        throw error;
      }
    }
    
    // Ensure session folder exists
    try {
      await dbx.filesCreateFolderV2({ path: sessionPath });
    } catch (error) {
      // Folder might already exist, ignore conflict error
      if (error.error?.error?.['.tag'] !== 'path' || error.error?.error?.path?.['.tag'] !== 'conflict') {
        throw error;
      }
    }
    
    const fileSize = videoBlob.size;
    const arrayBuffer = await videoBlob.arrayBuffer();
    
    // Use simple upload for files under 150MB
    if (fileSize <= MAX_SIMPLE_UPLOAD_SIZE) {
      await dbx.filesUpload({
        path,
        contents: arrayBuffer,
        mode: { '.tag': 'overwrite' },
      });
    } else {
      // Use chunked upload for large files
      const chunks = Math.ceil(fileSize / CHUNK_SIZE);
      let uploadSessionId = null;
      let offset = 0;
      
      // Start upload session
      const firstChunk = arrayBuffer.slice(0, Math.min(CHUNK_SIZE, fileSize));
      const sessionStartResponse = await dbx.filesUploadSessionStart({
        contents: firstChunk,
        close: chunks === 1, // If only one chunk, close the session
      });
      
      uploadSessionId = sessionStartResponse.result.session_id;
      offset += firstChunk.byteLength;
      
      // Upload remaining chunks
      for (let i = 1; i < chunks; i++) {
        const chunkStart = i * CHUNK_SIZE;
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, fileSize);
        const chunk = arrayBuffer.slice(chunkStart, chunkEnd);
        const isLastChunk = i === chunks - 1;
        
        await dbx.filesUploadSessionAppendV2({
          cursor: {
            session_id: uploadSessionId,
            offset: offset,
          },
          contents: chunk,
          close: isLastChunk,
        });
        
        offset += chunk.byteLength;
      }
      
      // Finish the upload session
      await dbx.filesUploadSessionFinish({
        cursor: {
          session_id: uploadSessionId,
          offset: fileSize,
        },
        commit: {
          path: path,
          mode: { '.tag': 'overwrite' },
        },
      });
    }
    
    return path;
  } catch (error) {
    console.error('Error uploading video:', error);
    
    // Extract error message from Dropbox error format
    let errorMessage = error.message || 'Unknown error';
    if (error.error?.error_summary) {
      errorMessage = error.error.error_summary;
    } else if (error.error?.error?.['.tag']) {
      errorMessage = `Dropbox error: ${error.error.error['.tag']}`;
    }
    
    // Handle specific error types
    if (error.status === 409) {
      errorMessage = `Upload conflict: ${errorMessage}. The file or folder may already exist.`;
    } else if (errorMessage.includes('payload_too_large')) {
      errorMessage = `File is too large. Please use chunked upload (this should have been handled automatically). Error: ${errorMessage}`;
    }
    
    throw new Error(`Failed to upload video: ${errorMessage}`);
  }
}

/**
 * Save session metadata and segments to Dropbox
 * @param {string} sessionId - Unique session identifier
 * @param {Object} data - Session data (meta, pairs, segments)
 * @returns {Promise<void>}
 */
export async function saveSessionData(sessionId, data) {
  const dbx = await getDropboxClient();
  const path = `${BASE_PATH}/${sessionId}/session.json`;
  
  try {
    // Add savedAt timestamp to the session data
    const dataWithTimestamp = {
      ...data,
      savedAt: new Date().toISOString(),
    };
    
    const jsonString = JSON.stringify(dataWithTimestamp, null, 2);
    
    await dbx.filesUpload({
      path,
      contents: jsonString,
      mode: { '.tag': 'overwrite' },
    });
  } catch (error) {
    console.error('Error saving session data:', error);
    throw new Error(`Failed to save session data: ${error.message}`);
  }
}

/**
 * Save coding progress to Dropbox
 * @param {string} sessionId - Session identifier
 * @param {Object} progressData - Progress data with answers and current position
 * @returns {Promise<void>}
 */
export async function saveProgress(sessionId, progressData) {
  const dbx = await getDropboxClient();
  const path = `${BASE_PATH}/${sessionId}/progress.json`;
  
  try {
    const jsonString = JSON.stringify({
      ...progressData,
      lastModified: new Date().toISOString(),
    }, null, 2);
    
    await dbx.filesUpload({
      path,
      contents: jsonString,
      mode: { '.tag': 'overwrite' },
    });
  } catch (error) {
    console.error('Error saving progress:', error);
    throw new Error(`Failed to save progress: ${error.message}`);
  }
}

/**
 * Load progress from Dropbox
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object|null>} Progress data or null if not found
 */
export async function loadProgress(sessionId) {
  const dbx = await getDropboxClient();
  const path = `${BASE_PATH}/${sessionId}/progress.json`;
  
  try {
    const response = await dbx.filesDownload({ path });
    const text = await response.result.fileBlob.text();
    return JSON.parse(text);
  } catch (error) {
    if (error.status === 409) {
      // File doesn't exist yet (not an error)
      return null;
    }
    console.error('Error loading progress:', error);
    throw new Error(`Failed to load progress: ${error.message}`);
  }
}

/**
 * List all available sessions from Dropbox
 * @returns {Promise<Array>} Array of session metadata
 */
export async function listSessions() {
  const dbx = await getDropboxClient();
  
  try {
    // Create base folder if it doesn't exist
    try {
      await dbx.filesCreateFolderV2({ path: BASE_PATH });
    } catch (error) {
      // Folder might already exist, ignore error
      if (error.error?.error?.['.tag'] !== 'path' || error.error?.error?.path?.['.tag'] !== 'conflict') {
        throw error;
      }
    }
    
    const response = await dbx.filesListFolder({ path: BASE_PATH });
    const sessions = [];
    
    // Get all session folders
    for (const entry of response.result.entries) {
      if (entry['.tag'] === 'folder') {
        const sessionId = entry.name;
        
        try {
          // Load session metadata
          const sessionDataPath = `${BASE_PATH}/${sessionId}/session.json`;
          const sessionResponse = await dbx.filesDownload({ path: sessionDataPath });
          const sessionData = JSON.parse(await sessionResponse.result.fileBlob.text());
          
          // Load progress if exists
          let progress = null;
          try {
            progress = await loadProgress(sessionId);
          } catch (error) {
            // Progress file might not exist yet
          }
          
          // Use the session.json file's modified date, or savedAt from data if it exists
          const uploadDate = sessionData.savedAt || sessionResponse.result.client_modified || entry.client_modified;
          
          sessions.push({
            id: sessionId,
            label: `${sessionData.meta.participant_id || 'Unknown'} | Order ${sessionData.meta.order || '?'}`,
            meta: sessionData.meta,
            savedAt: uploadDate,
            progress: progress,
            status: getSessionStatus(sessionData, progress),
          });
        } catch (error) {
          console.warn(`Skipping session ${sessionId}:`, error);
        }
      }
    }
    
    // Sort by modification time (newest first)
    return sessions.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  } catch (error) {
    console.error('Error listing sessions:', error);
    throw new Error(`Failed to list sessions: ${error.message}`);
  }
}

/**
 * Determine session coding status
 * @param {Object} sessionData - Session data with segments
 * @param {Object|null} progress - Progress data
 * @returns {string} Status: 'uncoded', 'in_progress', 'completed'
 */
function getSessionStatus(sessionData, progress) {
  if (!progress || !progress.answers || Object.keys(progress.answers).length === 0) {
    return 'uncoded';
  }
  
  // Count total segments that need coding
  const childSegments = sessionData.segments.filter(s => s.type === 'child_response');
  const parentSegments = sessionData.segments.filter(s => s.type === 'parent_question');
  const totalSegments = childSegments.length + parentSegments.length;
  
  // Count coded segments
  const codedSegments = Object.keys(progress.answers).length;
  
  if (progress.phase === 3 || codedSegments >= totalSegments) {
    return 'completed';
  }
  
  return 'in_progress';
}

/**
 * Load a complete session (data and video URL) from Dropbox
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object>} Session object with videoURL and pkg
 */
export async function loadSession(sessionId) {
  const dbx = await getDropboxClient();
  
  try {
    // Load session data
    const sessionDataPath = `${BASE_PATH}/${sessionId}/session.json`;
    const sessionResponse = await dbx.filesDownload({ path: sessionDataPath });
    const sessionData = JSON.parse(await sessionResponse.result.fileBlob.text());
    
    // Load video file
    const videoPath = `${BASE_PATH}/${sessionId}/video.mp4`;
    const videoResponse = await dbx.filesDownload({ path: videoPath });
    const videoBlob = videoResponse.result.fileBlob;
    const videoURL = URL.createObjectURL(videoBlob);
    
    return {
      id: sessionId,
      videoURL,
      pkg: sessionData,
    };
  } catch (error) {
    console.error('Error loading session:', error);
    throw new Error(`Failed to load session: ${error.message}`);
  }
}

/**
 * Delete a session from Dropbox
 * @param {string} sessionId - Session identifier
 * @returns {Promise<void>}
 */
export async function deleteSession(sessionId) {
  const dbx = await getDropboxClient();
  const path = `${BASE_PATH}/${sessionId}`;
  
  try {
    await dbx.filesDeleteV2({ path });
  } catch (error) {
    console.error('Error deleting session:', error);
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

/**
 * Append coding responses to master spreadsheet
 * @param {Array} rows - Array of row objects to append
 * @returns {Promise<void>}
 */
export async function appendToMasterSpreadsheet(rows) {
  const dbx = await getDropboxClient();
  const path = `${BASE_PATH}/master_responses.csv`;
  
  try {
    // Try to download existing file
    let existingData = [];
    let headers = null;
    
    try {
      const response = await dbx.filesDownload({ path });
      const text = await response.result.fileBlob.text();
      const lines = text.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        headers = lines[0].split(',');
        existingData = lines.slice(1);
      }
    } catch (error) {
      // File doesn't exist yet, will create new
      if (error.status !== 409) {
        throw error;
      }
    }
    
    // Helper to escape CSV values
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    
    // If no existing file, create headers from first row
    if (!headers && rows.length > 0) {
      headers = Object.keys(rows[0]);
    }
    
    // Convert rows to CSV lines
    const newLines = rows.map((r) => headers.map((h) => esc(r[h])).join(','));
    
    // Combine existing and new data
    const allLines = [...existingData, ...newLines];
    const csv = [headers.join(','), ...allLines].join('\n');
    
    // Upload updated file
    await dbx.filesUpload({
      path,
      contents: csv,
      mode: { '.tag': 'overwrite' },
    });
  } catch (error) {
    console.error('Error appending to master spreadsheet:', error);
    throw new Error(`Failed to append to master spreadsheet: ${error.message}`);
  }
}

