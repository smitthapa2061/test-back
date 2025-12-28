const axios = require('axios');
const mongoose = require('mongoose');
const MatchSelection = require('../../models/MatchSelection.model');
const Round = require('../../models/round.model');
const MatchData = require('../../models/matchData.model');
const Match = require('../../models/match.model');
const { getBackpackModel } = require('../../models/bgpackModel');
const { getCache, setCache } = require('../../middleware/cache');
const { getSocket } = require('../../socket');

// Per-user backpack polling state
const backpackPollState = new Map();
const userKeyToDbId = new Map();
const lastBackpackInfoByUser = {};

const MIN_INTERVAL = 2000; // 2s
const MAX_INTERVAL = 30000; // 30s
const INITIAL_INTERVAL = 2000; // 2s
const NO_CHANGE_THRESHOLD = 1;

// Fetch data from the external API and store in the database
const fetchBackpackInfo = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';
    const response = await axios.get(`${PUBG_API_URL}/getteambackpackinfo`);
    const data = response.data.teambackpackinfo.TeamBackPackList;

    const Backpack = getBackpackModel(matchDataId);

    // Clear existing data for the matchData and user
    await Backpack.deleteMany({ userId });

    // Assuming data is an array of backpack items
    if (Array.isArray(data)) {
      const items = data.map(item => ({ ...item, matchDataId, userId }));
      await Backpack.insertMany(items);
    } else {
      // If single object, insert as one document
      await new Backpack({ ...data, matchDataId, userId }).save();
    }

    res.json({ message: 'Backpack info fetched and stored successfully' });
  } catch (error) {
    console.error('Error fetching backpack info:', error);
    res.status(500).json({ error: 'Failed to fetch backpack info' });
  }
};

// Read (Get) backpack data for a matchData
const getBackpack = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const Backpack = getBackpackModel(matchDataId);
    const data = await Backpack.find({ userId });

    // Fetch matchData and match to get IDs
    const matchDataDoc = await MatchData.findById(matchDataId);
    if (!matchDataDoc) {
      return res.status(404).json({ error: 'MatchData not found' });
    }
    const match = await Match.findById(matchDataDoc.matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Remove userId from each item in data
    const cleanedData = data.map(item => {
      const itemObj = item.toObject();
      delete itemObj.userId;
      return itemObj;
    });

    res.json({
      userId,
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      matchId: match._id,
      matchDataId,
      teambackpackinfo: {
        TeamBackPackList: cleanedData
      }
    });
  } catch (error) {
    console.error('Error getting backpack data:', error);
    res.status(500).json({ error: 'Failed to get backpack data' });
  }
};

// Create a new backpack item or bulk create from TeamBackPackList
const createBackpackItem = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const Backpack = getBackpackModel(matchDataId);

    // Check if body contains teambackpackinfo structure
    if (req.body.teambackpackinfo && req.body.teambackpackinfo.TeamBackPackList) {
      const items = req.body.teambackpackinfo.TeamBackPackList.map(item => ({ ...item, userId }));
      const insertedItems = await Backpack.insertMany(items);
      res.json(insertedItems);
    } else if (req.body.throwableInfo && req.body.throwableInfo.throwableList) {
      const items = req.body.throwableInfo.throwableList.map(item => ({ ...item, userId }));
      const insertedItems = await Backpack.insertMany(items);
      res.json(insertedItems);
    } else if (Array.isArray(req.body)) {
      const items = req.body.map(item => ({ ...item, userId }));
      const insertedItems = await Backpack.insertMany(items);
      res.json(insertedItems);
    } else {
      // Single item creation
      const newItem = new Backpack({ ...req.body, userId });
      await newItem.save();
      res.json(newItem);
    }
  } catch (error) {
    console.error('Error creating backpack item:', error);
    res.status(500).json({ error: 'Failed to create backpack item' });
  }
};

// Update an existing backpack item
const updateBackpackItem = async (req, res) => {
  try {
    const { matchDataId, id } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const Backpack = getBackpackModel(matchDataId);
    const updatedItem = await Backpack.findOneAndUpdate({ _id: id, userId }, req.body, { new: true });
    if (!updatedItem) {
      return res.status(404).json({ error: 'Backpack item not found' });
    }
    res.json(updatedItem);
  } catch (error) {
    console.error('Error updating backpack item:', error);
    res.status(500).json({ error: 'Failed to update backpack item' });
  }
};

// Delete a backpack item
const deleteBackpackItem = async (req, res) => {
  try {
    const { matchDataId, id } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const Backpack = getBackpackModel(matchDataId);
    const deletedItem = await Backpack.findOneAndDelete({ _id: id, userId });
    if (!deletedItem) {
      return res.status(404).json({ error: 'Backpack item not found' });
    }
    res.json({ message: 'Backpack item deleted successfully' });
  } catch (error) {
    console.error('Error deleting backpack item:', error);
    res.status(500).json({ error: 'Failed to delete backpack item' });
  }
};

function startBackpackUpdater() {
  console.log('[BACKPACK] Backpack info updater started');
  const io = getSocket();

  const getOrInitUserState = (userKey) => {
    const key = String(userKey);
    let s = backpackPollState.get(key);
    if (!s) {
      s = { intervalMs: INITIAL_INTERVAL, noChangeCount: 0, timer: null };
      backpackPollState.set(key, s);
    }
    return s;
  };

  const adjustIntervalForUser = (userKey, hadChanges) => {
    const s = getOrInitUserState(userKey);
    if (hadChanges) {
      s.noChangeCount = 0;
      s.intervalMs = Math.max(MIN_INTERVAL, s.intervalMs - 500);
    } else {
      s.noChangeCount += 1;
      if (s.noChangeCount >= NO_CHANGE_THRESHOLD) {
        s.intervalMs = Math.min(MAX_INTERVAL, s.intervalMs + 500);
      }
    }
  };

  const scheduleNextUserPoll = (userKey) => {
    const s = getOrInitUserState(userKey);
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(async () => {
      const hadChanges = await pollBackpackInfoForUser(userKey);
      adjustIntervalForUser(userKey, hadChanges);
      scheduleNextUserPoll(userKey);
    }, s.intervalMs);
  };

  const pollBackpackInfoForUser = async (userKey) => {
    let hadChanges = false;
    const dbUserId = userKeyToDbId.get(String(userKey)) || (mongoose.Types.ObjectId.isValid(String(userKey)) ? new mongoose.Types.ObjectId(String(userKey)) : userKey);

    try {
      // Get all rounds with API enabled
      const apiEnabledRounds = await Round.find({ apiEnable: true });
      if (!apiEnabledRounds.length) {
        return false;
      }

      const roundIds = apiEnabledRounds.map(r => r._id.toString());

      // Find selected matches only for rounds with API enabled for this user
      const selectedMatches = await MatchSelection.find({
        isSelected: true,
        userId: dbUserId,
        roundId: { $in: roundIds },
        isPollingActive: true,
      });

      if (!selectedMatches.length) {
        return false;
      }

      // Fetch backpack info from PUBG API with caching
      const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';
      const cacheKey = 'pubg:backpackinfo';

      let backpackInfo;
      try {
        // Try cache first
        backpackInfo = await getCache(cacheKey);
        if (!backpackInfo) {
          // Fetch from API
          const backpackRes = await axios.get(`${PUBG_API_URL}/getteambackpackinfo`, { timeout: 5000 });
          backpackInfo = backpackRes.data.teambackpackinfo?.TeamBackPackList || [];
          // Cache for 30 seconds
          await setCache(cacheKey, backpackInfo, 30);
        }

        // Store for each active matchData
        for (const selected of selectedMatches) {
          const matchData = await MatchData.findOne({ matchId: selected.matchId, userId: dbUserId });
          if (matchData) {
            const Backpack = getBackpackModel(matchData._id);
            const existing = await Backpack.find({ userId: dbUserId });
            const existingData = existing.map(item => ({
              PlayerKey: item.PlayerKey,
              TeamID: item.TeamID,
              // Add other fields as needed for comparison
            }));

            if (JSON.stringify(backpackInfo) !== JSON.stringify(existingData)) {
              await Backpack.deleteMany({ userId: dbUserId });
              if (Array.isArray(backpackInfo)) {
                const items = backpackInfo.map(item => ({ ...item, matchDataId: matchData._id, userId: dbUserId }));
                await Backpack.insertMany(items);
              }
              hadChanges = true;
              // Emit backpack update to user
              io.to(String(dbUserId)).emit('backpackUpdate', { matchDataId: matchData._id, TeamBackPackList: backpackInfo });
            }
          }
        }

      } catch (apiErr) {
        console.warn('[BACKPACK] API connection failed:', apiErr.code);
      }

    } catch (err) {
      console.error(`[BACKPACK] Poll error for user ${userKey}:`, err.message);
    }

    return hadChanges;
  };

  // Discover active users and manage their polling loops
  const discoverAndStartBackpackPollingUsers = async () => {
    try {
      const apiEnabledRounds = await Round.find({ apiEnable: true });
      if (!apiEnabledRounds.length) {
        return;
      }

      const roundIds = apiEnabledRounds.map(r => r._id.toString());

      const selectedMatches = await MatchSelection.find({
        isSelected: true,
        roundId: { $in: roundIds },
        isPollingActive: true,
      });

      const activeUserKeys = [];
      for (const s of selectedMatches) {
        const key = String(s.userId);
        userKeyToDbId.set(key, s.userId);
        activeUserKeys.push(key);
      }
      const activeUserIds = [...new Set(activeUserKeys)];

      // Start polling for new active users
      for (const uid of activeUserIds) {
        const state = getOrInitUserState(uid);
        if (!state.timer) {
          console.log(`[BACKPACK] Starting polling loop for user ${uid}`);
          scheduleNextUserPoll(uid);
        }
      }

      // Pause polling for users no longer active
      for (const existingUid of Array.from(backpackPollState.keys())) {
        if (!activeUserIds.includes(existingUid)) {
          const st = backpackPollState.get(existingUid);
          if (st?.timer) {
            clearTimeout(st.timer);
            st.timer = null;
          }
          st.noChangeCount = 0;
          st.intervalMs = MAX_INTERVAL;
          console.log(`[BACKPACK] Paused polling loop for inactive user ${existingUid}`);
        }
      }
    } catch (e) {
      console.error('[BACKPACK] Discovery error:', e);
    }
  };

  // Initial discovery and periodic reconciliation
  discoverAndStartBackpackPollingUsers();
  setInterval(discoverAndStartBackpackPollingUsers, 10000); // reconcile every 10s
}

module.exports = {
  fetchBackpackInfo,
  getBackpack,
  createBackpackItem,
  updateBackpackItem,
  deleteBackpackItem,
  startBackpackUpdater
};