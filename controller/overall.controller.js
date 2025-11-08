const mongoose = require('mongoose');
const Match = require('../models/match.model');
const MatchData = require('../models/matchData.model');
const Round = require('../models/round.model');
const Tournament = require('../models/tournament.model');
const { createMatchDataForMatchDoc } = require('./matchData.controller');

// Numeric player fields to aggregate (sum)
const NUMERIC_PLAYER_FIELDS = [
  'health',
  'healthMax',
  'liveState',
  'killNum',
  'killNumBeforeDie',
  'gotAirDropNum',
  'maxKillDistance',
  'damage',
  'killNumInVehicle',
  'killNumByGrenade',
  'AIKillNum',
  'BossKillNum',
  'rank',
  'inDamage',
  'headShotNum',
  'survivalTime',
  'driveDistance',
  'marchDistance',
  'assists',
  'outsideBlueCircleTime',
  'knockouts',
  'rescueTimes',
  'useSmokeGrenadeNum',
  'useFragGrenadeNum',
  'useBurnGrenadeNum',
  'useFlashGrenadeNum',
  'PoisonTotalDamage',
  'UseSelfRescueTime',
  'UseEmergencyCallTime',
  'contribution'
];

function sumNumericFields(target, source, fields) {
  for (const f of fields) {
    const a = Number(target[f] || 0);
    const b = Number(source[f] || 0);
    target[f] = a + b;
  }
}

// Build an initial player aggregate object based on incoming player doc
function buildInitialAggPlayer(p) {
  const base = {
    uId: p.uId || '',
    _id: p._id, // MongoDB player ObjectId
    playerName: p.playerName || '',
    playerOpenId: p.playerOpenId || '',
    picUrl: p.picUrl || '',
    showPicUrl: p.showPicUrl || '',
    character: p.character || '',
    isFiring: false,
    bHasDied: false,
    location: { x: 0, y: 0, z: 0 },
    health: 0,
    healthMax: 0,
    liveState: 0,
    killNum: 0,
    killNumBeforeDie: 0,
    playerKey: p.playerKey || '',
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
    teamIdfromApi: p.teamIdfromApi || '',
    contribution: 0,
  };
  return base;
}

// GET overall aggregated matchData for a round in a tournament
// Response mirrors matchData structure: { teams: [ { teamId, teamName, teamTag, teamLogo, slot, placePoints, players: [...] } ] }
const getOverallMatchDataForRound = async (req, res) => {
  try {
    const userId = req.session && req.session.userId;

    const { tournamentId, roundId, matchId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tournamentId) || !mongoose.Types.ObjectId.isValid(roundId) || !mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ error: 'Invalid tournamentId, roundId, or matchId' });
    }

    // Verify round exists (skip ownership for public routes)
    const round = await Round.findOne({ _id: roundId, tournamentId, ...(userId && { createdBy: userId }) });
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Verify match exists (skip ownership for public routes)
    const targetMatch = await Match.findOne({ _id: matchId, tournamentId, roundId, ...(userId && { userId }) });
    if (!targetMatch) return res.status(404).json({ error: 'Match not found' });

    // Fetch all matches for this tournament/round, sorted by matchNo
    const matches = await Match.find({ tournamentId, roundId, ...(userId && { userId }) }, { _id: 1, matchNo: 1 }).sort({ matchNo: 1 }).lean();
    if (!matches || matches.length === 0) {
      return res.json({ tournamentId, roundId, matchId, ...(userId && { userId }), teams: [] });
    }

    // Filter matches up to but not including the target match's matchNo
    const filteredMatches = matches.filter(m => m.matchNo < targetMatch.matchNo);

    const matchIds = filteredMatches.map(m => m._id);

    // Ensure matchData exists for each match (create if missing to follow current pattern)
    const existing = await MatchData.find({ matchId: { $in: matchIds }, ...(userId && { userId }) }).select('_id matchId').lean();
    const existingMap = new Map(existing.map(md => [md.matchId.toString(), md._id]));

    for (const m of matchIds) {
      if (!existingMap.has(m.toString())) {
        try {
          await createMatchDataForMatchDoc(m);
        } catch (e) {
          // If creation fails, skip; we will aggregate what we have
          console.warn('Could not create MatchData for match', m.toString(), e?.message || e);
        }
      }
    }

    // Load all matchData after attempting creation
    const matchDatas = await MatchData.find({ matchId: { $in: matchIds }, ...(userId && { userId }) }).lean();

    // Deduplicate matchDatas by matchId to avoid summing the same data multiple times
    const uniqueMatchDatas = [];
    const seenMatchIds = new Set();
    for (const md of matchDatas) {
      if (!seenMatchIds.has(md.matchId.toString())) {
        seenMatchIds.add(md.matchId.toString());
        uniqueMatchDatas.push(md);
      }
    }

    // Aggregate by teamId
    const teamsMap = new Map(); // key: teamId string -> aggregated team
    const playersMap = new Map(); // key: uId string -> aggregated player

    // First, deduplicate players by uId within each matchData's teams
    const deduplicatedMatchDatas = matchDatas.map(md => ({
      ...md,
      teams: md.teams.map(team => ({
        ...team,
        players: (() => {
          const playerMap = new Map();
          for (const p of team.players || []) {
            const key = p.uId || '';
            if (!playerMap.has(key)) {
              playerMap.set(key, { ...p });
            } else {
              // Sum numeric fields if duplicate uId
              sumNumericFields(playerMap.get(key), p, NUMERIC_PLAYER_FIELDS);
              // Update display fields if present
              if (p.playerName) playerMap.get(key).playerName = p.playerName;
              if (p.picUrl) playerMap.get(key).picUrl = p.picUrl;
              if (p.showPicUrl) playerMap.get(key).showPicUrl = p.showPicUrl;
              if (p.character) playerMap.get(key).character = p.character;
              if (p.playerOpenId) playerMap.get(key).playerOpenId = p.playerOpenId;
              if (p.uId) playerMap.get(key).uId = p.uId;
              if (p.teamIdfromApi) playerMap.get(key).teamIdfromApi = p.teamIdfromApi;
            }
          }
          return Array.from(playerMap.values());
        })()
      }))
    }));

    for (const md of deduplicatedMatchDatas) {
      for (const team of md.teams || []) {
        const teamKey = team.teamId.toString();
        if (!teamsMap.has(teamKey)) {
          teamsMap.set(teamKey, {
            teamId: team.teamId,
            teamName: team.teamName || '',
            teamTag: team.teamTag || '',
            teamLogo: team.teamLogo || '',
            slot: Number.isFinite(team.slot) ? team.slot : 0,
            placePoints: 0,
            wwcd: 0,
            players: new Set(), // set of uId strings
          });
        }

        const aggTeam = teamsMap.get(teamKey);
        // Keep the most representative team fields if missing
        if (!aggTeam.teamName && team.teamName) aggTeam.teamName = team.teamName;
        if (!aggTeam.teamTag && team.teamTag) aggTeam.teamTag = team.teamTag;
        if (!aggTeam.teamLogo && team.teamLogo) aggTeam.teamLogo = team.teamLogo;

        // slot: choose the smallest slot (stable across round) if multiple
        if (Number.isFinite(team.slot)) {
          aggTeam.slot = Math.min(aggTeam.slot || team.slot, team.slot);
        }

        aggTeam.placePoints += Number(team.placePoints || 0);
        if (Number(team.placePoints || 0) === 10) {
          aggTeam.wwcd += 1;
        }

        // Aggregate players globally by uId
        for (const p of team.players || []) {
          const pKey = p.uId || '';
          if (!playersMap.has(pKey)) {
            playersMap.set(pKey, buildInitialAggPlayer(p));
          }
          const aggPlayer = playersMap.get(pKey);

          // Always update latest display fields if present
          if (p.playerName) aggPlayer.playerName = p.playerName;
          if (p.picUrl) aggPlayer.picUrl = p.picUrl;
          if (p.showPicUrl) aggPlayer.showPicUrl = p.showPicUrl;
          if (p.character) aggPlayer.character = p.character;
          if (p.playerOpenId) aggPlayer.playerOpenId = p.playerOpenId;
          if (p.uId) aggPlayer.uId = p.uId;
          if (p.teamIdfromApi) aggPlayer.teamIdfromApi = p.teamIdfromApi;

          // Sum numeric stats
          sumNumericFields(aggPlayer, p, NUMERIC_PLAYER_FIELDS);

          // Add uId to team's players set
          aggTeam.players.add(pKey);
        }
      }
    }

    // Convert players Map to arrays and sort teams by slot asc
    const aggregatedTeams = Array.from(teamsMap.values()).map(t => ({
      teamId: t.teamId,
      teamName: t.teamName,
      teamTag: t.teamTag,
      teamLogo: t.teamLogo,
      slot: t.slot || 0,
      placePoints: t.placePoints,
      wwcd: t.wwcd,
      players: Array.from(t.players).map(uId => playersMap.get(uId)),
    })).sort((a, b) => (a.slot || 0) - (b.slot || 0));

    // Final deduplication by uId within each team's players to ensure no duplicates
    for (const t of aggregatedTeams) {
      t.players = Array.from(new Map(t.players.map(p => [p.uId, p])).values());
    }

    return res.json({ tournamentId, roundId, matchId, ...(userId && { userId }), teams: aggregatedTeams, createdAt: new Date() });
  } catch (error) {
    console.error('Error generating overall matchData:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getOverallMatchDataForRound,
};
