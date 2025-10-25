const axios = require('axios');
const mongoose = require('mongoose');
const MatchSelection = require('../../models/MatchSelection.model');
const Round = require('../../models/round.model');

// Per-user circle info polling state
const circlePollState = new Map();
const userKeyToDbId = new Map();
const lastCircleInfoByUser = {};

const MIN_INTERVAL = 2000; // 2s
const MAX_INTERVAL = 10000; // 10s
const INITIAL_INTERVAL = 2500; // 2.5s
const NO_CHANGE_THRESHOLD = 1;

const { getSocket } = require('../../socket');

function startCircleInfoUpdater() {
  console.log('[CIRCLE] Circle info updater started');
  const io = getSocket();

  // Emit current circle info to all connected clients immediately
  const emitCurrentCircleInfo = async () => {
    try {
      const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';
      const circleRes = await axios.get(`${PUBG_API_URL}/getcircleinfo`, { timeout: 5000 });
      const circleInfo = circleRes.data.circleInfo || circleRes.data;
      // Emit current circle info to all clients
      io.emit('circleInfoUpdate', circleInfo);
    } catch (err) {
      console.warn('Could not fetch initial circle info:', err.code);
    }
  };

  // Emit immediately when updater starts
  emitCurrentCircleInfo();

  const getOrInitUserState = (userKey) => {
    const key = String(userKey);
    let s = circlePollState.get(key);
    if (!s) {
      s = { intervalMs: INITIAL_INTERVAL, noChangeCount: 0, timer: null };
      circlePollState.set(key, s);
    }
    return s;
  };

  const adjustIntervalForUser = (userKey, hadChanges) => {
    const s = getOrInitUserState(userKey);
    if (hadChanges) {
      s.noChangeCount = 0;
      s.intervalMs = Math.max(MIN_INTERVAL, s.intervalMs - 1000);
    } else {
      s.noChangeCount += 1;
      if (s.noChangeCount >= NO_CHANGE_THRESHOLD) {
        s.intervalMs = Math.min(MAX_INTERVAL, s.intervalMs + 1000);
      }
    }
    // Adaptive interval logging removed for cleaner output
  };

  const scheduleNextUserPoll = (userKey) => {
    const s = getOrInitUserState(userKey);
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(async () => {
      const hadChanges = await pollCircleInfoForUser(userKey);
      adjustIntervalForUser(userKey, hadChanges);
      scheduleNextUserPoll(userKey);
    }, s.intervalMs);
  };

  const pollCircleInfoForUser = async (userKey) => {
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

      // Fetch circle info from PUBG API
      const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';

      try {
        const circleRes = await axios.get(`${PUBG_API_URL}/getcircleinfo`, { timeout: 5000 });
        const circleInfo = circleRes.data.circleInfo || circleRes.data;

        // Always emit circle info for now to ensure it reaches frontend
        io.emit('circleInfoUpdate', circleInfo);
        lastCircleInfoByUser[String(userKey)] = circleInfo;
        hadChanges = true;

      } catch (apiErr) {
        console.warn(`[CIRCLE] API connection failed:`, apiErr.code);
      }

    } catch (err) {
      console.error(`[CIRCLE] Poll error:`, err.message);
    }

    return hadChanges;
  };

  // Discover active users and manage their polling loops
  const discoverAndStartCirclePollingUsers = async () => {
    try {
      const apiEnabledRounds = await Round.find({ apiEnable: true });
      if (!apiEnabledRounds.length) {
        return;
      }

      const roundIds = apiEnabledRounds.map(r => r._id.toString());

      const selectedMatches = await MatchSelection.find({
        isSelected: true,
        userId: { $exists: true, $ne: null },
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
          scheduleNextUserPoll(uid);
        }
      }

      // Pause polling for users no longer active
      for (const existingUid of Array.from(circlePollState.keys())) {
        if (!activeUserIds.includes(existingUid)) {
          const st = circlePollState.get(existingUid);
          if (st?.timer) {
            clearTimeout(st.timer);
            st.timer = null;
          }
          st.noChangeCount = 0;
          st.intervalMs = MAX_INTERVAL;
        }
      }
    } catch (e) {
      console.error('[circle discovery] Error:', e);
    }
  };

  // Initial discovery and periodic reconciliation
  discoverAndStartCirclePollingUsers();
  setInterval(discoverAndStartCirclePollingUsers, 10000); // reconcile every 15s
}

module.exports = { startCircleInfoUpdater };