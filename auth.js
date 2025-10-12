const express = require('express');
const open = require('open').default;
const axios = require('axios');
const keytar = require('keytar');
require('dotenv').config();

const app = express();
const port = 3000;

const SERVICE_NAME = 'twitch-electron';
const ACCOUNT_NAME = 'twitch-user';

let accessToken = null;
let refreshToken = null;

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
 * Refresh token when expired
 */
async function refreshAccessToken() {
  if (!refreshToken) {
    console.log('⚠️ No refresh token available');
    return null;
  }

  console.log('🔄 Refreshing Twitch token...');
  try {
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      null,
      {
        params: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.TWITCH_CLIENT_ID,
          client_secret: process.env.TWITCH_CLIENT_SECRET,
        },
      }
    );

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    await saveToken(response.data);
    console.log('✅ Token refreshed successfully');
    return accessToken;
  } catch (err) {
    console.error('❌ Failed to refresh token:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Handle Twitch OAuth callback
 */
app.get('/auth', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('No code found.');

  try {
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      null,
      {
        params: {
          client_id: process.env.TWITCH_CLIENT_ID,
          client_secret: process.env.TWITCH_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: 'http://localhost:3000/auth',
        },
      }
    );

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    await saveToken(response.data);

    res.send('✅ Authentication successful! You can close this window.');
    console.log('✅ Access Token saved securely.');
  } catch (error) {
    console.error('❌ Error fetching access token:', error.response?.data || error.message);
    res.send('Error fetching access token');
  }
});

app.listen(port, () => {
  console.log(`OAuth server running on http://localhost:${port}`);
});

/**
 * Launch Twitch OAuth flow
 */
function startAuthFlow() {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=http://localhost:3000/auth&response_type=code&scope=channel:manage:polls+channel:manage:predictions`;
  open(authUrl);
}

function getToken() {
  return accessToken;
}

// Add this function near the bottom of auth.js
async function logout() {
  try {
    await keytar.deletePassword('twitch-electron', 'twitch-user-access');
    await keytar.deletePassword('twitch-electron', 'twitch-user-refresh');
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
  const storedAccess = await keytar.getPassword('twitch-electron', 'twitch-user-access');
  return !!storedAccess;
}

module.exports = {
  startAuthFlow,
  getToken,
  loadToken,
  refreshAccessToken,
  logout,
  isLoggedIn, // ✅ add this
};