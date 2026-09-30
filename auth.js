const open = require('open').default;
const axios = require('axios');
const keytar = require('keytar');
const { TWITCH_CLIENT_ID } = require('./config');

const SERVICE_NAME = 'twitch-electron';
const ACCOUNT_NAME = 'twitch-user';
const SCOPES = 'channel:manage:polls channel:manage:predictions';

let accessToken = null;
let refreshToken = null;
let pendingAuth = null;

/**
 * Load tokens from system keychain
 */
async function loadToken() {
  try {
    accessToken = await keytar.getPassword(SERVICE_NAME, `${ACCOUNT_NAME}-access`);
    refreshToken = await keytar.getPassword(SERVICE_NAME, `${ACCOUNT_NAME}-refresh`);
    if (accessToken) {
      console.log('🔑 Loaded tokens from keychain');
    } else {
      console.log('⚠️ No saved tokens found');
    }
  } catch (err) {
    console.error('❌ Error loading token:', err.message);
  }
}

/**
 * Save tokens to system keychain
 */
async function saveToken({ access_token, refresh_token }) {
  try {
    await keytar.setPassword(SERVICE_NAME, `${ACCOUNT_NAME}-access`, access_token);
    if (refresh_token) {
      await keytar.setPassword(SERVICE_NAME, `${ACCOUNT_NAME}-refresh`, refresh_token);
    }
    console.log('💾 Tokens saved securely in keychain');
  } catch (err) {
    console.error('❌ Error saving token:', err.message);
  }
}

/**
 * POST a form-encoded request to the Twitch OAuth endpoints
 */
function postForm(url, fields) {
  return axios.post(url, new URLSearchParams(fields).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/**
 * Refresh token when expired.
 * Public clients refresh without a secret; each refresh token can only be used once.
 */
async function refreshAccessToken() {
  if (!refreshToken) {
    console.log('⚠️ No refresh token available');
    return null;
  }

  console.log('🔄 Refreshing Twitch token...');
  try {
    const response = await postForm('https://id.twitch.tv/oauth2/token', {
      client_id: TWITCH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    await saveToken(response.data);
    console.log('✅ Token refreshed successfully');
    return accessToken;
  } catch (err) {
    console.error('❌ Failed to refresh token:', err.response?.data || err.message);
    // The saved tokens are no longer valid (expired, revoked, or from the old login flow)
    if (err.response?.status === 400 || err.response?.status === 401) {
      await logout();
    }
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Twitch Device Code flow: works without a client secret or a local server.
 * Opens the Twitch activation page (code pre-filled) and waits for the user to approve.
 */
async function runDeviceFlow() {
  const { data: device } = await postForm('https://id.twitch.tv/oauth2/device', {
    client_id: TWITCH_CLIENT_ID,
    scopes: SCOPES,
  });

  console.log(`🔗 Opening ${device.verification_uri} (code: ${device.user_code})`);
  open(device.verification_uri);

  let interval = (device.interval || 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    try {
      const { data } = await postForm('https://id.twitch.tv/oauth2/token', {
        client_id: TWITCH_CLIENT_ID,
        scopes: SCOPES,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      accessToken = data.access_token;
      refreshToken = data.refresh_token;
      await saveToken(data);
      console.log('✅ Access Token saved securely.');
      return { success: true };
    } catch (err) {
      const message = err.response?.data?.message;
      if (message === 'authorization_pending') continue;
      if (message === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Login timed out. Please try again.');
}

/**
 * Launch Twitch login. Resolves once the user has approved (or it failed).
 */
async function startAuthFlow() {
  if (!pendingAuth) {
    pendingAuth = runDeviceFlow()
      .catch((err) => {
        const error = err.response?.data?.message || err.message;
        console.error('❌ Login failed:', err.response?.data || err.message);
        return { success: false, error };
      })
      .finally(() => {
        pendingAuth = null;
      });
  }
  return pendingAuth;
}

function getToken() {
  return accessToken;
}

async function logout() {
  try {
    await keytar.deletePassword(SERVICE_NAME, `${ACCOUNT_NAME}-access`);
    await keytar.deletePassword(SERVICE_NAME, `${ACCOUNT_NAME}-refresh`);
    accessToken = null;
    refreshToken = null;
    console.log('🔒 Tokens deleted from keychain.');
    return { success: true };
  } catch (err) {
    console.error('❌ Error deleting tokens:', err.message);
    return { success: false, error: err.message };
  }
}

async function isLoggedIn() {
  // If token already loaded in memory
  if (accessToken) return true;

  // Otherwise, check if one is stored securely
  const storedAccess = await keytar.getPassword(SERVICE_NAME, `${ACCOUNT_NAME}-access`);
  return !!storedAccess;
}

module.exports = {
  TWITCH_CLIENT_ID,
  startAuthFlow,
  getToken,
  loadToken,
  refreshAccessToken,
  logout,
  isLoggedIn,
};
