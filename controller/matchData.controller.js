const MatchData = require('../models/matchData.model');
const Match = require('../models/match.model');
const Round = require('../models/round.model');
const Tournament = require('../models/tournament.model');
const Group = require('../models/group.model.js');
const { getSocket } = require('../socket.js'); // import socket instance
const mongoose = require('mongoose');
const requireAuth = require('../authMiddleware.js');
const { computeOverallMatchDataForRound } = require('./overall.controller');



const createMatchDataForMatchDoc = async (matchOrId) => {
  try {
    if (!matchOrId) throw new Error('No matchId provided');
    const matchId = typeof matchOrId === 'object' && matchOrId._id ? matchOrId._id : matchOrId;

    // Fetch Match and populate nested groups -> slots -> team -> players
    const match = await Match.findById(matchId).populate({
      path: 'groups',
      populate: {
        path: 'slots.team',
        populate: {
          path: 'players', // ensure players are populated
        }
      }
    });

    if (!match) throw new Error('Match not found');

    // Flatten all teams from populated match.groups[].slots[].team
  // Flatten all teams from populated match.groups[].slots[].team
let teams = (match.groups || []).flatMap(group =>
  (group.slots || [])
    .filter(slot => slot.team)
    .map(slot => ({
      slot: slot.slot, // ✅ add slot
      teamId: slot.team._id,
      teamLogo : slot.team.logo || '',
      teamName: slot.team.teamFullName || slot.team.teamName || '',
        teamTag: slot.team.teamTag || '',
      players: (slot.team.players || []).slice(0, 4).map(player => ({
        uId: player.playerId || '',
        _id: player._id,
        playerName: player.playerName,
        playerOpenId: player.playerOpenId || '',
        picUrl: player.photo || '',
        showPicUrl: '',
        character: 'None',
        isFiring: false,
        bHasDied: false,
        location: { x: 0, y: 0, z: 0 },
        health: 0,
        healthMax: 0,
        liveState: 0,
        killNum: 0,
        killNumBeforeDie: 0,
        playerKey: '',
        gotAirDropNum: 0,
        maxKillDistance: 0,
        damage: 0,
        killNumInVehicle: 0,
        killNumByGrenade: 0,
        AIKillNum: 0,
        BossKillNum: 0,
        rank: 0,
        isOutsideBlueCircle: false,
        inDamage: 0,
        heal: 0,
        headShotNum: 0,
        survivalTime: 0,
        driveDistance: 0,
        marchDistance: 0,
        assists: 0,
        outsideBlueCircleTime: 0,
        knockouts: 0,
        rescueTimes: 0,
        useSmokeGrenadeNum: 0,
        useFragGrenadeNum: 0,
        useBurnGrenadeNum: 0,
        useFlashGrenadeNum: 0,
        PoisonTotalDamage: 0,
        UseSelfRescueTime: 0,
        UseEmergencyCallTime: 0,
        teamIdfromApi: '',
        teamId: slot.slot,
        teamName: slot.team.teamFullName || '',
        contribution: 0,
      }))
    }))
);

// SORT teams by slot (lowest to highest)
teams.sort((a, b) => a.slot - b.slot);

// Create new MatchData document
const matchData = new MatchData({
  matchId: match._id,
  userId: match.userId,
  teams
});


    await matchData.save();
    return matchData;
  } catch (error) {
    console.error('Error creating MatchData:', error);
    throw error;
  }
};


 
// Get MatchData by matchId (user-scoped)
const getMatchDataByMatchId = async (req, res) => {
  try {
    const { matchId } = req.params;
    let userId = req.session && req.session.userId;

    // For public access, get userId from match's tournament
    if (!userId) {
      const match = await Match.findById(matchId);
      if (!match) return res.status(404).json({ error: 'Match not found' });
      const round = await Round.findById(match.roundId);
      if (!round) return res.status(404).json({ error: 'Round not found' });
      const tournament = await Tournament.findById(round.tournamentId);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      userId = tournament.createdBy;
    }

    // Try direct ownership first
    let match = await Match.findOne({ _id: matchId, userId });

    // Fallback for legacy matches without userId: find by id and verify via Round.createdBy
    if (!match) {
      const possible = await Match.findById(matchId);
      if (!possible) return res.status(404).json({ error: 'Match not found' });

      const round = await Round.findOne({ _id: possible.roundId, createdBy: userId });
      if (!round) return res.status(404).json({ error: 'Match not found or not yours' });

      // Backfill match.userId for legacy data
      await Match.updateOne({ _id: possible._id }, { $set: { userId } });
      match = possible;
      match.userId = userId;
    }

    // Find existing matchData for this user
    let matchData = await MatchData.findOne({ matchId: match._id, userId });

    // Auto-create if missing
    if (!matchData) {
      try {
        matchData = await createMatchDataForMatchDoc(match._id);
        // If created by legacy match without userId, ensure userId is set
        if (matchData && !matchData.userId) {
          matchData.userId = userId;
          await matchData.save();
        }
      } catch (e) {
        // If creation fails, return empty matchData
        return res.json({ _id: null, matchId: match._id, userId, teams: [] });
      }
    }

    if (!matchData) return res.json({ _id: null, matchId: match._id, userId, teams: [] });

    res.json(matchData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// === Update Team Points & Emit via Socket ===
const updateTeamPoints = async (req, res) => {
  const lockKey = `${req.params.matchDataId}-${req.params.teamId}-points`;

  // Check if this team points update is already in progress
  if (updateLocks.has(lockKey)) {
    console.log('Team points update already in progress for:', lockKey);
    return res.status(429).json({ error: 'Update already in progress, please wait' });
  }

  // Set lock
  updateLocks.set(lockKey, true);

  try {
    // Enforce ownership via match and matchData
    const { matchId, matchDataId } = req.params;
    const match = await Match.findOne({ _id: matchId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found or not yours' });
    const md = await MatchData.findOne({ _id: matchDataId, matchId, userId: req.session.userId });
    if (!md) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const { teamId } = req.params;
    const { placePoints } = req.body;

    if (typeof placePoints !== 'number') {
      return res.status(400).json({ error: 'placePoints must be a number' });
    }

    const result = await MatchData.findOneAndUpdate(
      { _id: matchDataId },
      { $set: { 'teams.$[team].placePoints': placePoints } },
      { new: true, arrayFilters: [{ 'team._id': teamId }] }
    );

    if (!result) return res.status(404).json({ error: 'MatchData or Team not found' });

    // Emit socket event to all clients
    const io = getSocket();
    io.emit('matchDataUpdated', {
      matchDataId,
      teamId,
      changes: { placePoints }
    });

    // Emit overall data update for real-time aggregation
    try {
      const overallTeams = await computeOverallMatchDataForRound(match.tournamentId, match.roundId, matchId, req.session.userId);
      io.emit('overallDataUpdate', { tournamentId: match.tournamentId, roundId: match.roundId, matchId, teams: overallTeams, createdAt: new Date() });
    } catch (overallError) {
      console.warn('Failed to emit overall data update:', overallError.message);
    }

    res.json({ message: 'Team placePoints updated', matchDataId, teamId, changes: { placePoints } });
  } catch (error) {
    console.error('Error updating team points:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Always remove the lock
    updateLocks.delete(lockKey);
  }
};

// Add a simple in-memory lock to prevent concurrent updates
const updateLocks = new Map();


const updatePlayerStats = async (req, res) => {
  
  try {
    console.log('updatePlayerStats called with params:', req.params);
    console.log('updatePlayerStats called with body:', req.body);
    
    // Authorization check
    const { matchId, matchDataId, teamId, playerId } = req.params;
    const updateData = req.body;

    // Validate required parameters
    if (!matchId || !matchDataId || !teamId || !playerId) {
      console.error('Missing required parameters:', { matchId, matchDataId, teamId, playerId });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Check if user session exists
    if (!req.session || !req.session.userId) {
      console.error('No user session found');
      return res.status(401).json({ error: 'Unauthorized - No session' });
    }

    console.log('User session found:', req.session.userId);

    // Verify ownership of match and matchData
    const match = await Match.findOne({ _id: matchId, userId: req.session.userId });
    if (!match) {
      console.error('Match not found or not owned by user:', matchId, req.session.userId);
      return res.status(404).json({ error: 'Match not found or not yours' });
    }
    
    const md = await MatchData.findOne({ _id: matchDataId, matchId, userId: req.session.userId });
    if (!md) {
      console.error('MatchData not found or not owned by user:', matchDataId, req.session.userId);
      return res.status(404).json({ error: 'MatchData not found or not yours' });
    }

    console.log('Authorization checks passed');

    // Find the specific matchData, team, and player
    console.log('Finding MatchData by ID:', matchDataId);
    const updatedMatchData = await MatchData.findById(matchDataId);
    if (!updatedMatchData) {
      console.error('MatchData not found by ID:', matchDataId);
      return res.status(404).json({ error: 'MatchData not found' });
    }

    console.log('Finding team by ID:', teamId);
    const team = updatedMatchData.teams.find(t => t._id.toString() === teamId);
    if (!team) {
      console.error('Team not found by ID:', teamId, 'Available teams:', updatedMatchData.teams.map(t => t._id.toString()));
      return res.status(404).json({ error: 'Team not found' });
    }

    console.log('Finding player by ID:', playerId);
    const player = team.players.find(p => p._id.toString() === playerId);
    if (!player) {
      console.error('Player not found by ID:', playerId, 'Available players:', team.players.map(p => p._id.toString()));
      return res.status(404).json({ error: 'Player not found' });
    }

    console.log('Found player:', player.playerName);

    // Handle killNumChange separately (simple increment operation)
    if (updateData.killNumChange !== undefined) {
      console.log(`Updating killNum for player ${player.playerName} by ${updateData.killNumChange}`);
      
      // Simple direct update to avoid complex MongoDB operations
      const newKillNum = Math.max(0, player.killNum + updateData.killNumChange);
      player.killNum = newKillNum;
      
      console.log(`Updated killNum for ${player.playerName}: ${player.killNum}`);
    }

    // Update all other player stats fields
    const allowedFields = [
      'playerName', 'playerOpenId', 'picUrl', 'showPicUrl', 'character', 'isFiring',
      'bHasDied', 'health', 'healthMax', 'liveState', 'killNum', 'killNumBeforeDie',
      'playerKey', 'gotAirDropNum', 'maxKillDistance', 'damage', 'killNumInVehicle',
      'killNumByGrenade', 'AIKillNum', 'BossKillNum', 'rank', 'isOutsideBlueCircle',
      'inDamage', 'headShotNum', 'survivalTime', 'driveDistance', 'marchDistance',
      'assists', 'outsideBlueCircleTime', 'knockouts', 'rescueTimes',
      'useSmokeGrenadeNum', 'useFragGrenadeNum', 'useBurnGrenadeNum', 'useFlashGrenadeNum',
      'PoisonTotalDamage', 'UseSelfRescueTime', 'UseEmergencyCallTime', 'teamIdfromApi',
      'contribution', 'location'
    ];

    let hasUpdates = false;
    const updates = {};

    // Update player fields
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined && field !== 'killNumChange') {
        player[field] = updateData[field];
        updates[field] = updateData[field];
        hasUpdates = true;
      }
    });

    // Save changes if any updates were made
    if (hasUpdates || updateData.killNumChange !== undefined) {
      updatedMatchData.markModified("teams");
      await updatedMatchData.save();
    }

    // Include killNum in updates if it was changed
    if (updateData.killNumChange !== undefined) {
      updates.killNum = player.killNum;
    }

    // Emit socket event with all updates
    try {
      const io = getSocket();
      
      console.log(`Emitting playerStatsUpdated for player ${player.playerName}: killNum = ${player.killNum}`);
      
      io.emit('playerStatsUpdated', {
        matchDataId,
        teamId,
        playerId,
        updates,
      });

      // Also emit a team-level update to ensure team totals are recalculated
      if (updates.killNum !== undefined) {
        const teamTotalKills = team.players.reduce((sum, p) => sum + (p.killNum || 0), 0);
        console.log(`Team ${team.teamTag || team.teamName} total kills: ${teamTotalKills}`);
        
        io.emit('teamStatsUpdated', {
          matchDataId,
          teamId,
          totalKills: teamTotalKills,
          players: team.players.map(p => ({ _id: p._id, killNum: p.killNum }))
        });
      }
    } catch (socketError) {
      console.error('Socket emission error:', socketError);
      // Continue execution even if socket fails
    }

    // Emit overall data update for real-time aggregation
    try {
      const match = await Match.findById(matchId);
      if (match) {
        const overallTeams = await computeOverallMatchDataForRound(match.tournamentId, match.roundId, matchId, req.session.userId);
        const io = getSocket();
        io.emit('overallDataUpdate', { tournamentId: match.tournamentId, roundId: match.roundId, matchId, teams: overallTeams, createdAt: new Date() });
      }
    } catch (overallError) {
      console.warn('Failed to emit overall data update:', overallError.message);
    }

    res.json({ message: 'Player stats updated', player });
  } catch (error) {
    console.error('Error in updatePlayerStats:', error);
    res.status(500).json({ error: error.message });
  }
};



const deleteMatchDataById = async (req, res) => {
  try {
    const { tournamentId, roundId, id } = req.params;
    const match = await Match.findOneAndDelete({ _id: id, tournamentId, roundId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found in this round/tournament' });
    await MatchData.deleteMany({ matchId: match._id, userId: req.session.userId });
    return res.json({ message: 'Match and related MatchData deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Bulk update all players in a team (e.g., toggle bHasDied for entire team)
const updateTeamPlayersBulkStats = async (req, res) => {
  const lockKey = `${req.params.matchDataId}-${req.params.teamId}-bulk`;

  // Check if this bulk update is already in progress
  if (updateLocks.has(lockKey)) {
    console.log('Bulk team update already in progress for:', lockKey);
    return res.status(429).json({ error: 'Update already in progress, please wait' });
  }

  // Set lock
  updateLocks.set(lockKey, true);

  try {
    const { matchId, matchDataId, teamId } = req.params;
    const { bHasDied } = req.body;

    if (typeof bHasDied !== 'boolean') {
      return res.status(400).json({ error: 'bHasDied must be a boolean' });
    }

    // Ownership checks
    const match = await Match.findOne({ _id: matchId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found or not yours' });

    const matchData = await MatchData.findOne({ _id: matchDataId, matchId, userId: req.session.userId });
    if (!matchData) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const team = matchData.teams.find(t => t._id.toString() === teamId);
    if (!team) return res.status(404).json({ error: 'Team not found in MatchData' });

    // Update all players in memory then save once
    team.players.forEach(p => { p.bHasDied = bHasDied; });
    matchData.markModified('teams');
    await matchData.save();

    // Emit a single team-level event
    const io = getSocket();
    io.emit('matchDataUpdated', {
      matchDataId: matchData._id.toString(),
      teamId: team._id.toString(),
      changes: { players: team.players.map(p => ({ _id: p._id, bHasDied: p.bHasDied })) },
    });

    // Emit overall data update for real-time aggregation
    try {
      const overallTeams = await computeOverallMatchDataForRound(match.tournamentId, match.roundId, matchId, req.session.userId);
      io.emit('overallDataUpdate', { tournamentId: match.tournamentId, roundId: match.roundId, matchId, teams: overallTeams, createdAt: new Date() });
    } catch (overallError) {
      console.warn('Failed to emit overall data update:', overallError.message);
    }

    return res.json({ message: 'Team players updated', teamId, bHasDied });
  } catch (error) {
    console.error('Error in bulk team update:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Always remove the lock
    updateLocks.delete(lockKey);
  }
};

const updatePlayerByIdInMatchData = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const md = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!md) return res.status(404).json({ error: 'MatchData not found or not yours' });
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { matchDataId, teamId } = req.params;
    const { replacements } = req.body; 
    // replacements = [{ oldPlayerId, newPlayerId }, ...]

    if (!Array.isArray(replacements) || replacements.length === 0) {
      return res.status(400).json({ error: 'No replacements provided' });
    }

    // Fetch matchData
    const matchData = await MatchData.findById(matchDataId);
    if (!matchData) return res.status(404).json({ error: 'MatchData not found' });

    // Find the team
    const team = matchData.teams.find(t => t.teamId.toString() === teamId);
    if (!team) return res.status(404).json({ error: 'Team not found in MatchData' });

    // Fetch original match to get player info
    const match = await Match.findById(matchData.matchId).populate({
      path: 'groups',
      populate: { path: 'slots.team', model: 'Team' }
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const matchTeam = match.groups.flatMap(g => g.slots)
      .map(s => s.team)
      .find(t => t && t._id.toString() === teamId);
    if (!matchTeam) return res.status(404).json({ error: 'Matching team not found in match groups' });

    // Loop through replacements
    replacements.forEach(({ oldPlayerId, newPlayerId }) => {
      const playerIndex = team.players.findIndex(p => p._id.toString() === oldPlayerId);
      if (playerIndex === -1) return;

      const newPlayer = matchTeam.players.find(p => p._id.toString() === newPlayerId);
      if (!newPlayer) return;

      // Replace player data
      team.players[playerIndex] = {
      uId: newPlayer.playerId || '', // ✅ always use newPlayer's ID
        _id: newPlayer._id,
        playerName: newPlayer.playerName,
        playerOpenId: newPlayer.playerOpenId || '',
        picUrl: newPlayer.photo || '',
        showPicUrl: '',
        character: '',
        isFiring: false,
        bHasDied: false,
        location: { x: 0, y: 0, z: 0 },
        health: 0,
        healthMax: 0,
        liveState: 0,
        killNum: 0,
        killNumBeforeDie: 0,
        playerKey: '',
        gotAirDropNum: 0,
        maxKillDistance: 0,
        damage: 0,
        killNumInVehicle: 0,
        killNumByGrenade: 0,
        AIKillNum: 0,
        BossKillNum: 0,
        rank: 0,
        isOutsideBlueCircle: false,
        inDamage: 0,
        headShotNum: 0,
        survivalTime: 0,
        driveDistance: 0,
        marchDistance: 0,
        assists: 0,
        outsideBlueCircleTime: 0,
        knockouts: 0,
        rescueTimes: 0,
        useSmokeGrenadeNum: 0,
        useFragGrenadeNum: 0,
        useBurnGrenadeNum: 0,
        useFlashGrenadeNum: 0,
        PoisonTotalDamage: 0,
        UseSelfRescueTime: 0,
        UseEmergencyCallTime: 0,
       teamIdfromApi: '',
        contribution: 0,
      };
    });

    // Save changes
    matchData.markModified('teams');
    await matchData.save();

    return res.json({ message: 'Players updated successfully', team });
  } catch (err) {
    console.error('Error updating players in MatchData:', err);
    return res.status(500).json({ error: err.message });
  }
};



const addPlayersToTeamInMatchData = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const md = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!md) return res.status(404).json({ error: 'MatchData not found or not yours' });
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { matchDataId, teamId } = req.params;
    const { newPlayerIds } = req.body; // Expect an array of player IDs

    if (!Array.isArray(newPlayerIds) || newPlayerIds.length === 0) {
      return res.status(400).json({ error: 'newPlayerIds must be a non-empty array' });
    }

    // Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(matchDataId) ||
      !mongoose.Types.ObjectId.isValid(teamId) ||
      !newPlayerIds.every(id => mongoose.Types.ObjectId.isValid(id))
    ) {
      return res.status(400).json({ error: 'Invalid ObjectId format for one or more IDs' });
    }

    const matchData = await MatchData.findById(matchDataId);
    if (!matchData) return res.status(404).json({ error: 'MatchData not found' });

    const team = matchData.teams.find(t => t.teamId.toString() === teamId);
    if (!team) return res.status(404).json({ error: 'Team not found in this MatchData' });

    // Load original Match
    const match = await Match.findById(matchData.matchId).populate({
      path: 'groups',
      populate: { path: 'slots.team', model: 'Team' }
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    let matchTeam = null;
    for (const group of match.groups || []) {
      for (const slot of group.slots || []) {
        if (slot.team && slot.team._id.toString() === team.teamId.toString()) {
          matchTeam = slot.team;
          break;
        }
      }
      if (matchTeam) break;
    }

    if (!matchTeam) return res.status(404).json({ error: 'Matching team not found in match groups' });

    // Filter out duplicates
    const playersToAdd = newPlayerIds
      .filter(id => !team.players.some(p => p._id.toString() === id))
      .map(id => matchTeam.players.find(p => p._id.toString() === id))
      .filter(Boolean);

    if (playersToAdd.length === 0) {
      return res.status(400).json({ error: 'All players are already in the team or invalid' });
    }

    // Add each player with reset stats
    playersToAdd.forEach(newPlayer => {
      team.players.push({
         uId: newPlayer.playerId || '', // ✅ always use newPlayer's ID
        _id: newPlayer._id,
        playerName: newPlayer.playerName,
        playerOpenId: newPlayer.playerOpenId || '',
        picUrl: newPlayer.photo || '',
        showPicUrl: '',
        character: '',
        isFiring: false,
        bHasDied: false,
        location: { x: 0, y: 0, z: 0 },
        health: 0,
        healthMax: 0,
        liveState: 0,
        killNum: 0,
        killNumBeforeDie: 0,
        playerKey: '',
        gotAirDropNum: 0,
        maxKillDistance: 0,
        damage: 0,
        killNumInVehicle: 0,
        killNumByGrenade: 0,
        AIKillNum: 0,
        BossKillNum: 0,
        rank: 0,
        isOutsideBlueCircle: false,
        inDamage: 0,
        headShotNum: 0,
        survivalTime: 0,
        driveDistance: 0,
        marchDistance: 0,
        assists: 0,
        outsideBlueCircleTime: 0,
        knockouts: 0,
        rescueTimes: 0,
        useSmokeGrenadeNum: 0,
        useFragGrenadeNum: 0,
        useBurnGrenadeNum: 0,
        useFlashGrenadeNum: 0,
        PoisonTotalDamage: 0,
        UseSelfRescueTime: 0,
        UseEmergencyCallTime: 0,
    teamIdfromApi: '',
        contribution: 0,
      });
    });

    matchData.markModified('teams');
    await matchData.save();

    return res.json({ message: 'Players added successfully', team });
  } catch (error) {
    console.error('Error adding players to MatchData:', error);
    return res.status(500).json({ error: error.message });
  }
};




const removePlayersFromTeamInMatchData = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    const md = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!md) return res.status(404).json({ error: 'MatchData not found or not yours' });
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { matchDataId, teamId } = req.params;
    const { playerIds } = req.body; // expect array of player IDs

    // Validate input
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ error: 'playerIds must be a non-empty array' });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(matchDataId) || !mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: 'Invalid ObjectId format for matchDataId or teamId' });
    }

    const invalidPlayer = playerIds.find(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidPlayer) {
      return res.status(400).json({ error: `Invalid ObjectId format for playerId: ${invalidPlayer}` });
    }

    // Find MatchData
    const matchData = await MatchData.findById(matchDataId);
    if (!matchData) return res.status(404).json({ error: 'MatchData not found' });

    // Find team
    const team = matchData.teams.find(t => t.teamId.toString() === teamId);
    if (!team) return res.status(404).json({ error: 'Team not found in this MatchData' });

    // Remove all players in playerIds array
    team.players = team.players.filter(p => !playerIds.includes(p._id.toString()));

    matchData.markModified('teams');
    await matchData.save();

    return res.json({ message: 'Players removed successfully', team });
  } catch (error) {
    console.error('Error removing players from MatchData:', error);
    return res.status(500).json({ error: error.message });
  }
};


module.exports = {
  createMatchDataForMatchDoc,
  getMatchDataByMatchId,
  updateTeamPoints,
  deleteMatchDataById,

  updatePlayerStats,
  updatePlayerByIdInMatchData,
  addPlayersToTeamInMatchData,
  removePlayersFromTeamInMatchData,
  updateTeamPlayersBulkStats
};
