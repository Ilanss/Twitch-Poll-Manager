// auth.js
const { BrowserWindow, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, 'auth.json');
const CLIENT_ID = 'YOUR_TWITCH_CLIENT_ID';
const REDIRECT_URI = 'http://localhost:3000';
const SCOPES = [
  'channel:manage:polls',
  'channel:read:polls',
  'channel:manage:predictions',
  'channel:read:predictions',
  'user:read:email'
];

function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function loadToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH));
  }
  return null;
}

function clearToken() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

function getAuthURL() {
  return `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(SCOPES.join(' '))}`;
}

async function startAuthFlow(mainWindow) {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: { nodeIntegration: false }
    });

    const url = getAuthURL();
    authWindow.loadURL(url);

    // Intercept the redirect with the token
    function handleRedirect(details) {
      const url = details.url;
      if (url.startsWith(REDIRECT_URI)) {
        const match = url.match(/access_token=([^&]*)/);
        if (match && match[1]) {
          const access_token = match[1];
          saveToken({ access_token });
          session.defaultSession.webRequest.onBeforeRequest(null); // cleanup
          authWindow.close();
          resolve(access_token);
        } else {
          reject(new Error('No token found'));
        }
      }
    }

    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://localhost/*'] }, handleRedirect);

    authWindow.on('closed', () => reject(new Error('User closed window')));
  });
}

ipcMain.handle('auth:login', async (event) => {
  try {
    const token = loadToken();
    if (token?.access_token) return token.access_token;
    const newToken = await startAuthFlow();
    return newToken;
  } catch (err) {
    console.error('Auth error:', err);
    return null;
  }
});

ipcMain.handle('auth:logout', async () => {
  clearToken();
  return true;
});

module.exports = { loadToken };
