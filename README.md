# Polar Questions Coding

This respository contains code for a blind-coding website, made specifically for our study on polar questions. This website allows a researcher to upload videos and split them into segments, and another researcher to blind-code child responses and parent questions. Video segments and responses (in CSV format) are saved on Dropbox. <br />
> [!NOTE]
> To keep the videos secure, there's a password to enter the system. If you have any questions or run into any issues, please contact hsierliu@fas.harvard.edu. This repository was last updated *November 24, 2025*.


## Task procedure

**Upload videos**
1. Enter participant information (ID, age in months, order)
2. Upload the video file and use the timeline to split the video into segments:
   - Press "s" key or click "split at..." to create a split
   - Use spacebar to play/pause
   - Zoom in/out for precision
3. Assign each segment a type and pair. Press "play" to ensure the correct segment is selected.
   - **Type**: parent_question, child_response, continued_response, or other
   - **Pair**: Which question this segment belongs to
4. Click "upload to dropbox" to save each video.

**Code videos**
1. Select an un-coded session and click "load selected"
2. Click "start coding" to begin
3. For each video segment, answer the questions:
   - **Phase 1**: Child response questions
   - **Phase 2**: Parent question questions
3. Click "save to dropbox" to save the responses


## Miscellaneous

**How to get the refresh token for Dropbox (if videos are not uploading or retrievable)**

1. Set up dropbox: 
   - Go to the Dropbox developer and open the App settings. 
   - Under **"OAuth 2"** and under **"Redirect URIs"**, add `http://localhost:3000/oauth-callback`.

2. In terminal, install the required Node.js packages:
   ```bash
   npm install express open
   ```

3. Run the refresh token generator script:
   ```bash
   node get-dropbox-refresh-token.js
   ```

4. Follow the prompts:
   - Enter your **App Key**
   - Enter your **App Secret**
   - A browser window will open
   - Click **"Allow"** to authorize the app

5. The script will output something like:
   ```
   VITE_DROPBOX_APP_KEY = your_app_key_here
   VITE_DROPBOX_APP_SECRET = your_app_secret_here
   VITE_DROPBOX_REFRESH_TOKEN = your_refresh_token_here
   ```

6. Enter the variables to the **.env** file (local) or under **environmental variables** on Vercel (full deployment).

