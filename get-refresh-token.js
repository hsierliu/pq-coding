/**
 * Run this script to get refresh token for Dropbox:
 */

import express from 'express';
import open from 'open';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n=== Dropbox Refresh Token Generator ===\n');
  console.log('This script will help you get a refresh token for your Dropbox app.\n');
  
  const appKey = await ask('Enter your Dropbox App Key: ');
  const appSecret = await ask('Enter your Dropbox App Secret: ');
  
  if (!appKey || !appSecret) {
    console.error('App Key and App Secret are required!');
    process.exit(1);
  }

  const app = express();
  const port = 3000;
  
  let authCode = null;
  
  app.get('/oauth-callback', (req, res) => {
    authCode = req.query.code;
    res.send('<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>');
    setTimeout(() => server.close(), 1000);
  });

  const server = app.listen(port, () => {
    console.log(`\nLocal server started on http://localhost:${port}`);
  });

  const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&response_type=code&token_access_type=offline&redirect_uri=http://localhost:${port}/oauth-callback`;
  
  console.log('\nOpening browser for authorization...');
  console.log('If the browser does not open, visit this URL manually:');
  console.log(authUrl);
  console.log('');
  
  await open(authUrl);

  await new Promise((resolve) => {
    server.on('close', resolve);
  });

  if (!authCode) {
    console.error('Authorization failed - no code received');
    process.exit(1);
  }

  console.log('\nExchanging authorization code for refresh token...');

  try {
    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: authCode,
        grant_type: 'authorization_code',
        client_id: appKey,
        client_secret: appSecret,
        redirect_uri: `http://localhost:${port}/oauth-callback`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get refresh token: ${error}`);
    }

    const data = await response.json();
    
    console.log('\n✅ Success! Your refresh token:\n');
    console.log(data.refresh_token);
    console.log('\n📋 Add these to your .env file:\n');
    console.log(`VITE_DROPBOX_APP_KEY=${appKey}`);
    console.log(`VITE_DROPBOX_APP_SECRET=${appSecret}`);
    console.log(`VITE_DROPBOX_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('\n⚠️  Keep these credentials secure and do not commit them to version control!\n');
    
  } catch (error) {
    console.error('Error getting refresh token:', error.message);
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

main().catch(console.error);

