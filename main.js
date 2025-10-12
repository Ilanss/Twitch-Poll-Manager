const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();
const { startAuthFlow, getToken, loadToken, refreshAccessToken, logout } = require('./auth');
const dataFile = path.join(app.getPath('userData'), 'savedEngagements.json');

let win;

async function createWindow() {
  await loadToken(); // load from keychain
  await refreshAccessToken(); // refresh if needed

  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('auth', async () => {
  startAuthFlow();
});

ipcMain.handle('createEngagement', async (event, data) => {
  const token = getToken();
  if (!token) return { error: 'User not authenticated yet.' };

  try {
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const broadcasterId = userRes.data.data[0].id;

    let url, payload;

    if (data.type === 'poll') {
      url = 'https://api.twitch.tv/helix/polls';
      payload = {
        broadcaster_id: broadcasterId,
        title: data.title,
        choices: data.choices,
        duration: data.duration,
      };
    } else if (data.type === 'prediction') {
      url = 'https://api.twitch.tv/helix/predictions';
      payload = {
        broadcaster_id: broadcasterId,
        title: data.title,
        outcomes: data.choices, // same structure but Twitch calls them "outcomes"
        prediction_window: data.duration, // prediction uses this field
      };
    }

    const response = await axios.post(url, payload, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error creating engagement:', error.response?.data || error.message);
    return { error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  return await logout();
});

ipcMain.handle('isLoggedIn', async () => {
  const { isLoggedIn } = require('./auth');
  return await isLoggedIn();
});

ipcMain.handle('getPollResults', async (event, pollId) => {
  const token = getToken();
  if (!token) return { error: 'User not authenticated yet.' };

  try {
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const broadcasterId = userRes.data.data[0].id;

    const res = await axios.get(
      `https://api.twitch.tv/helix/polls?broadcaster_id=${broadcasterId}&id=${pollId}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error('Error fetching poll results:', error.response?.data || error.message);
    return { error: error.message };
  }
});

ipcMain.handle('getPredictionResults', async (event, predictionId) => {
  const token = getToken();
  if (!token) return { error: 'User not authenticated yet.' };

  try {
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const broadcasterId = userRes.data.data[0].id;

    const res = await axios.get(
      `https://api.twitch.tv/helix/predictions?broadcaster_id=${broadcasterId}&id=${predictionId}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error('Error fetching prediction results:', error.response?.data || error.message);
    return { error: error.message };
  }
});

function loadSaved() {
  if (!fs.existsSync(dataFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAll(list) {
  fs.writeFileSync(dataFile, JSON.stringify(list, null, 2));
}

ipcMain.handle('getSavedEngagements', async () => loadSaved());

ipcMain.handle('saveEngagement', async (event, engagement) => {
  const list = loadSaved();
  // give it a simple ID
  engagement.id = engagement.id || Date.now().toString();
  list.push(engagement);
  saveAll(list);
  return { success: true, data: engagement };
});

ipcMain.handle('deleteEngagement', async (event, id) => {
  const list = loadSaved().filter(e => e.id !== id);
  saveAll(list);
  return { success: true };
});

ipcMain.handle('resolvePrediction', async (event, { predictionId, outcomeId, action }) => {
  const token = getToken();
  if (!token) return { error: 'User not authenticated yet.' };

  try {
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const broadcasterId = userRes.data.data[0].id;

    const payload = {
      broadcaster_id: broadcasterId,
      id: predictionId,
      status: action === 'cancel' ? 'CANCELED' : 'RESOLVED',
    };

    if (action !== 'cancel') {
      payload.winning_outcome_id = outcomeId;
    }

    const res = await axios.patch(
      'https://api.twitch.tv/helix/predictions',
      payload,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error('Error resolving prediction:', error.response?.data || error.message);
    return { error: error.message };
  }
});

ipcMain.handle('updateEngagement', async (event, updated) => {
  const list = loadSaved();
  const index = list.findIndex(e => e.id === updated.id);
  if (index === -1) return { error: 'Engagement not found' };

  // Update existing entry
  list[index] = { ...list[index], ...updated };
  saveAll(list);

  return { success: true, data: list[index] };
});

ipcMain.handle('reorderEngagements', async (event, newOrderIds) => {
  const list = loadSaved();
  const newList = newOrderIds
    .map(id => list.find(item => item.id === id))
    .filter(Boolean);
  saveAll(newList);
  return { success: true };
});
