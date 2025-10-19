const axios = require('axios');
const _ = require('lodash');
const mongoose = require('mongoose');
const MatchSelection = require('../../models/MatchSelection.model');
const MatchData = require('../../models/matchData.model');
const Round = require('../../models/round.model');
const Group = require('../../models/group.model');
const updateTeamsWithApiPlayers = require('./playerCheckandSwitch'); // adjust path

const { getSocket } = require('../../socket');

let lastMatchDataByMatch = {};
let lastPlayerDataByMatch = {};

// Adaptive polling variables
let currentInterval = 2500; // Start with 2.5 seconds
let consecutiveNoChanges = 0;
let pollTimer = null;

// ---------- helpers ----------
const idStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const idsEqual = (a, b) => idStr(a) === idStr(b);
const num = (v) => (v === null || v === undefined || v === '') ? NaN : Number(v);

function startLiveMatchUpdater() {
  console.log('Live match updater started');
  const io = getSocket();
  console.log('Socket.IO instance connected:', !!io);

  // Adaptive polling function
  const adjustInterval = (hadChanges) => {
    if (hadChanges) {
      consecutiveNoChanges = 0;
      currentInterval = Math.max(2000, currentInterval - 1000); // Decrease, min 1 second
    } else {
      consecutiveNoChanges++;
      if (consecutiveNoChanges >= 3) {
        currentInterval = Math.min(10000, currentInterval + 1000); // Increase, max 10 seconds
      }
    }
    console.log(`Adaptive polling: interval=${currentInterval}ms, consecutiveNoChanges=${consecutiveNoChanges}`);
  };

  // Schedule next poll
  const scheduleNextPoll = () => {
    pollTimer = setTimeout(async () => {
      const hadChanges = await poll();
      adjustInterval(hadChanges);
      scheduleNextPoll(); // Schedule next
    }, currentInterval);
  };

  // Start polling
  scheduleNextPoll();

  /**
   * Merge DB player data with API player data while preserving identity fields
   * - Never change playerName or picUrl if the same UID already exists in DB
   * - Only update picUrl if DB picUrl is empty; prefer Group photo then API pic
   */
 const mergePlayerData = (dbPlayer, apiPlayer, groupPlayers = []) => {
  if (!dbPlayer || !apiPlayer) return dbPlayer || apiPlayer;

  const safePic = (pic) => pic && pic.trim() ? pic : undefined;

  // find matching group player by ID (stringify both)
  const grpPlayer = groupPlayers.find(
    gp => String(gp.playerId).trim() === String(apiPlayer.uId).trim()
  );

  return {
    ...dbPlayer,
    ...apiPlayer,

    // preserve DB identity
    _id: dbPlayer._id,
    uId: dbPlayer.uId,
    playerName: dbPlayer.playerName, // keep DB name

    // picUrl: prefer DB → Group → API
    picUrl: safePic(dbPlayer.picUrl) || safePic(grpPlayer?.photo) || safePic(apiPlayer.picUrl) || '',
    showPicUrl: safePic(dbPlayer.showPicUrl) || safePic(grpPlayer?.photo) || safePic(apiPlayer.showPicUrl) || '',

    // live stats
    teamIdfromApi: apiPlayer.teamId,
    location: apiPlayer.location || { x: 0, y: 0, z: 0 },
    bHasDied: apiPlayer.liveState === 5 || dbPlayer.bHasDied
  };
};

const updateMatchDataWithLiveStats = async (matchId, userId) => {
  console.log(`[live] Begin update for matchId=${matchId} user=${userId}`);
  const matchData = await MatchData.findOne({ matchId, userId });
  if (!matchData) {
    console.log('No MatchData found for matchId:', matchId);
    return null;
  }

  // --- Get tournamentId directly from MatchSelection ---
  const selectedMatch = await MatchSelection.findOne({ matchId, isSelected: true, userId });
  const tournamentId = selectedMatch?.tournamentId;

  if (!tournamentId) {
    console.log('Cannot find tournamentId for matchId:', matchId);
    return null;
  }

  console.log(`Using tournamentId: ${tournamentId.toString()} for user ${userId}`);

  // --- Get Group data ---
  const group = await Group.findOne({ tournamentId, userId }).populate('slots.team');
  if (!group) {
    console.log('No group found for tournament:', tournamentId.toString());
    return null;
  }

  console.log(`Using group for tournament ${tournamentId.toString()} (user ${userId}):`);
  console.log(`Group ID: ${group._id}, Slots: ${group.slots.length}`);
  group.slots.forEach((slot, index) => {
    console.log(
      ` Slot ${index + 1}: teamId=${slot.team?._id}, teamName=${slot.team?.teamFullName}, players=${slot.team?.players?.length || 0}`
    );
  });

  // --- Get API players ---
  const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';
  
  let apiPlayers = [];
  try {
    const res = await axios.get(`${PUBG_API_URL}/gettotalplayerlist`, { timeout: 5000 });
    apiPlayers = res.data.playerInfoList || [];
    console.log(`API returned ${apiPlayers.length} players`);
  } catch (err) {
    console.warn(`⚠️ Could not connect to PUBG API at ${PUBG_API_URL}:`, err.code);
    console.log('Continuing without API data...');
    return matchData; // Return existing data without updates
  }
await updateTeamsWithApiPlayers(apiPlayers, matchId, userId);
  const normalizeId = id => (id ? String(id).trim() : '');

  for (const team of matchData.teams) {
    const newTeamPlayers = [];
    const usedUIds = new Set();

    // --- Find matching group slot ---
    const groupSlot = group.slots.find(s => s.team?._id.toString() === team.teamId.toString());
    const groupPlayers = groupSlot?.team?.players || [];
    const teamName = groupSlot?.team?.teamFullName || 'Unknown';

    const teamApiPlayers = apiPlayers.filter(p => Number(p.teamId) === Number(team.slot));
    const matchDataByUid = new Map((team.players || []).map(p => [normalizeId(p.uId), p]));

    // --- Step 1: Merge API + DB + Group ---
    for (const apiPlayer of teamApiPlayers) {
      if (newTeamPlayers.length >= 4) break;
      const uid = normalizeId(apiPlayer.uId);
      if (usedUIds.has(uid)) continue;

      const matchPlayer = matchDataByUid.get(uid);
      const grpPlayer = groupPlayers.find(p => normalizeId(p.playerId) === uid);

      let finalPlayer;

      if (matchPlayer || grpPlayer) {
        finalPlayer = {
          // Spread ALL API player data first
          ...apiPlayer,
          
          // Override with identity fields from DB/Group
          _id: new mongoose.Types.ObjectId(),
          uId: uid,
          playerOpenId: matchPlayer?.playerOpenId || grpPlayer?.playerOpenId || apiPlayer.playerOpenId || '',
          playerName: matchPlayer?.playerName?.trim() || grpPlayer?.playerName?.trim() || apiPlayer.playerName,
          picUrl: matchPlayer?.picUrl?.trim() || grpPlayer?.photo?.trim() || apiPlayer.picUrl || '',
          showPicUrl: '', // intentionally left empty
          
          // Ensure critical fields from API
          teamIdfromApi: team.slot,
          location: apiPlayer.location || { x: 0, y: 0, z: 0 },
          bHasDied: apiPlayer.liveState === 5,
          
          // All live stats from API (health, damage, etc.)
          health: apiPlayer.health || 0,
          healthMax: apiPlayer.healthMax || 100,
          liveState: apiPlayer.liveState || 0,
          killNum: apiPlayer.killNum || 0,
          killNumBeforeDie: apiPlayer.killNumBeforeDie || 0,
          damage: apiPlayer.damage || 0,
          assists: apiPlayer.assists || 0,
          knockouts: apiPlayer.knockouts || 0,
          headShotNum: apiPlayer.headShotNum || 0,
          survivalTime: apiPlayer.survivalTime || 0,
          isFiring: apiPlayer.isFiring || false,
          isOutsideBlueCircle: apiPlayer.isOutsideBlueCircle || false,
          inDamage: apiPlayer.inDamage || 0,
          driveDistance: apiPlayer.driveDistance || 0,
          marchDistance: apiPlayer.marchDistance || 0,
          outsideBlueCircleTime: apiPlayer.outsideBlueCircleTime || 0,
          rescueTimes: apiPlayer.rescueTimes || 0,
          gotAirDropNum: apiPlayer.gotAirDropNum || 0,
          maxKillDistance: apiPlayer.maxKillDistance || 0,
          killNumInVehicle: apiPlayer.killNumInVehicle || 0,
          killNumByGrenade: apiPlayer.killNumByGrenade || 0,
          AIKillNum: apiPlayer.AIKillNum || 0,
          BossKillNum: apiPlayer.BossKillNum || 0,
          useSmokeGrenadeNum: apiPlayer.useSmokeGrenadeNum || 0,
          useFragGrenadeNum: apiPlayer.useFragGrenadeNum || 0,
          useBurnGrenadeNum: apiPlayer.useBurnGrenadeNum || 0,
          useFlashGrenadeNum: apiPlayer.useFlashGrenadeNum || 0,
          PoisonTotalDamage: apiPlayer.PoisonTotalDamage || 0,
          UseSelfRescueTime: apiPlayer.UseSelfRescueTime || 0,
          UseEmergencyCallTime: apiPlayer.UseEmergencyCallTime || 0,
        };
        
        if (apiPlayer.killNum > 0 || apiPlayer.health < 100) {
          console.log(`Merged player ${finalPlayer.playerName}: kills=${finalPlayer.killNum}, health=${finalPlayer.health}/${finalPlayer.healthMax}`);
        }
      } else {
        finalPlayer = {
          // Spread ALL API player data
          ...apiPlayer,
          
          // Override identity fields
          _id: new mongoose.Types.ObjectId(),
          uId: uid,
          teamIdfromApi: team.slot,
          location: apiPlayer.location || { x: 0, y: 0, z: 0 },
          bHasDied: apiPlayer.liveState === 5,
          picUrl: apiPlayer.picUrl || '',
          showPicUrl: '',
          playerName: apiPlayer.playerName,
        };
        
        if (finalPlayer.killNum > 0 || finalPlayer.health < 100) {
          console.log(`New player ${finalPlayer.playerName}: kills=${finalPlayer.killNum}, health=${finalPlayer.health}/${finalPlayer.healthMax}`);
        }
      }

      newTeamPlayers.push(finalPlayer);
      usedUIds.add(uid);
      console.log(`[merged] uid=${uid} | name="${finalPlayer.playerName}" | picUrl="${finalPlayer.picUrl}"`);
    }

    // --- Step 2: Fill remaining from group if slots < 4 ---
   

    // --- Step 3: Assign team placePoints ---
    const teamRank = newTeamPlayers.length ? Math.min(...newTeamPlayers.map(p => p.rank || 0)) : 0;
    team.placePoints = (rank => {
      switch (rank) {
        case 1: return 10;
        case 2: return 6;
        case 3: return 5;
        case 4: return 4;
        case 5: return 3;
        case 6: return 2;
        case 7: return 1;
        case 8: return 1;
        default: return 0;
      }
    })(teamRank);

    team.players = newTeamPlayers;
    console.log(`Team slot ${team.slot} (${teamName}) final players:`, team.players.map(p => `${p.playerName}(${p.uId})`));
  }

  matchData.markModified('teams');
  await matchData.save();
  return matchData;
};


 const poll = async () => {
  let hadChanges = false;
  try {
    // Get all rounds with API enabled
    const apiEnabledRounds = await Round.find({ apiEnable: true });
    if (!apiEnabledRounds.length) {
      console.log('No rounds with API enabled found');
      return false;
    }

    const roundIds = apiEnabledRounds.map(r => r._id.toString());


    // Find selected matches only for rounds with API enabled
    const selectedMatches = await MatchSelection.find({
      isSelected: true,
      userId: { $exists: true, $ne: null },
      roundId: { $in: roundIds }
    });

    if (!selectedMatches.length) {
      console.log('No selected matches found in API-enabled rounds');
      return false;
    }

    for (const selected of selectedMatches) {
      const userId = selected.userId;
      if (!userId) {
        console.log(`Skipping selection ${selected._id} with missing userId`);
        continue;
      }

      const round = apiEnabledRounds.find(r => r._id.toString() === selected.roundId.toString());
      console.log(`Selected match: ${selected.matchId} for user ${userId}, round: ${round?.roundName || 'unknown'} `);

      // --- Check if polling is active for this match ---
      if (!selected.isPollingActive) {
        console.log(`Polling not active for match: ${selected.matchId} (user ${userId})`);
        continue; // Skip this match
      }

       if (!lastPlayerDataByMatch[selected.matchId]) {
         lastPlayerDataByMatch[selected.matchId] = {};
       }

       const updatedMatchData = await updateMatchDataWithLiveStats(selected.matchId, userId);

       if (updatedMatchData) {
         const lastData = lastMatchDataByMatch[selected.matchId];
         const currentData = updatedMatchData.toObject();

         if (!lastData) {
           console.log('No previous data, emitting liveMatchUpdate for match:', selected.matchId);
           io.emit('liveMatchUpdate', updatedMatchData);
           lastMatchDataByMatch[selected.matchId] = currentData;
           hadChanges = true;
         } else {
           const isEqual = _.isEqual(currentData, lastData);
           console.log('Data comparison for match:', selected.matchId, 'isEqual:', isEqual);

           if (!isEqual) {
             // Log specific differences in kill numbers
             currentData.teams.forEach((team, teamIndex) => {
               const lastTeam = lastData.teams[teamIndex];
               if (lastTeam) {
                 team.players.forEach((player, playerIndex) => {
                   const lastPlayer = lastTeam.players[playerIndex];
                   if (lastPlayer && player.killNum !== lastPlayer.killNum) {
                     console.log(`Kill change detected - Team: ${team.teamTag}, Player: ${player.playerName}, Old: ${lastPlayer.killNum}, New: ${player.killNum}`);
                   }
                 });
               }
             });

             console.log('Emitting liveMatchUpdate for match:', selected.matchId);
             io.emit('liveMatchUpdate', updatedMatchData);
             lastMatchDataByMatch[selected.matchId] = currentData;
             hadChanges = true;
           } else {
             console.log('No changes detected for match:', selected.matchId);
           }
         }
       }
     }
   } catch (err) {
     console.error('Poll error:', err);
   }
   return hadChanges;
 };



  // Adaptive polling started above
}

module.exports = { startLiveMatchUpdater };
