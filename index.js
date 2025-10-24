const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), ".env") });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { initializeSocket } = require('./socket.js');
const axios = require(require.resolve('axios'));
// Import routes
const groupRoutes = require('./route/group.route.js');
const teamRoutes = require('./route/team.route.js');
const tournamentRoutes = require('./route/tournament.route.js');
const roundRoutes = require('./route/round.route.js');
const matchRoutes = require('./route/match.route.js');
const matchDataRoutes = require('./route/matchData.route.js');
const matchSelectionRoutes = require('./route/matchSelection.route.js');
const overallRoutes = require('./route/overall.route.js');
const userRoutes = require('./route/User.route.js');
const { startLiveMatchUpdater } = require('./controller/Api_controllers/pubgApiMatchData.controller.js');
const { startCircleInfoUpdater } = require('./controller/Api_controllers/circleInfo.controller.js');

// --- DECLARE APP AND PORT ---
const app = express();
const port = process.env.PORT || 3000;

// Trust proxy (required for Render.com and other cloud platforms)
app.set('trust proxy', 1);

// --- CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- MIDDLEWARES ---
// CORS must come first
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "http://localhost:3001",
    
      "http://localhost:1420",
      "http://tauri.localhost",
      "tauri://com.admin.tauri-app",
      "tauri://localhost",
      "https://scoresync-v1.vercel.app",
    
    ];
    
    // Check if origin is allowed OR if it's a Vercel preview deployment
    if (allowedOrigins.includes(origin) || origin.includes('.vercel.app')) {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,               // allow sending cookies
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-cookie"],
}));

app.use(express.json());

// Middleware to handle custom cookie header for Tauri
app.use((req, res, next) => {
  if (req.headers['x-cookie']) {
    req.headers.cookie = req.headers['x-cookie'];
  }
  next();
});

// Auto-detect production: check NODE_ENV or if running on Render
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
console.log('🔧 Environment:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
console.log('🔧 RENDER:', process.env.RENDER);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'newsecret123',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    httpOnly: false, // false to allow JavaScript access
    secure: isProduction, // true for production/HTTPS, false for development
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site in production, 'lax' for development
    domain: undefined, // Let browser handle domain automatically
  },
  proxy: true, // Trust the reverse proxy (Render uses proxies)
});

// Middleware to add Partitioned attribute to cookies (Chrome requirement for cross-site cookies)
app.use((req, res, next) => {
  sessionMiddleware(req, res, (err) => {
    if (err) return next(err);
    
    // Add Partitioned attribute to Set-Cookie header in production
    if (isProduction) {
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = function(name, value) {
        if (name.toLowerCase() === 'set-cookie' && Array.isArray(value)) {
          value = value.map(cookie => {
            if (cookie.includes('connect.sid') && !cookie.includes('Partitioned')) {
              return cookie + '; Partitioned';
            }
            return cookie;
          });
        } else if (name.toLowerCase() === 'set-cookie' && typeof value === 'string') {
          if (value.includes('connect.sid') && !value.includes('Partitioned')) {
            value = value + '; Partitioned';
          }
        }
        return originalSetHeader(name, value);
      };
    }
    
    next();
  });
});

// Logging middleware (after session is set up)
app.use((req, res, next) => {
  console.log('📍', req.method, req.originalUrl);
  console.log('🍪 Cookies:', req.headers.cookie);
  console.log('🔑 Session ID:', req.sessionID);
  console.log('👤 User ID:', req.session?.userId);
  next();
});


// --- REGISTER ROUTES ---
app.use('/api/users', userRoutes);
app.use('/api', groupRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api', roundRoutes);
app.use('/api', matchRoutes);
app.use('/api', teamRoutes);
app.use('/api', matchDataRoutes);
app.use('/api/matchSelection', matchSelectionRoutes);
app.use('/api', overallRoutes);

// --- PUBLIC ROUTES (No Authentication Required) ---
const Tournament = require('./models/tournament.model');
const Match = require('./models/match.model');

// Public tournament data
app.get('/api/public/tournaments/:tournamentId', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public round data
app.get('/api/public/tournaments/:tournamentId/rounds/:roundId', async (req, res) => {
  try {
    const Round = require('./models/round.model');
    const round = await Round.findById(req.params.roundId);
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }
    res.json(round);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public match data
app.get('/api/public/matches/:matchId', async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public matchData
app.get('/api/public/matches/:matchId/matchdata', async (req, res) => {
  try {
    const MatchData = require('./models/matchData.model');
    const Match = require('./models/match.model');
    const match = await Match.findById(req.params.matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Find matchData for the match's userId, or any if no userId
    let matchData = await MatchData.findOne({ matchId: req.params.matchId, userId: match.userId });
    if (!matchData) {
      // Fallback to any matchData for this matchId
      matchData = await MatchData.findOne({ matchId: req.params.matchId });
    }
    if (!matchData) {
      // Try to create it if missing
      const { createMatchDataForMatchDoc } = require('./controller/matchData.controller');
      try {
        matchData = await createMatchDataForMatchDoc(req.params.matchId);
      } catch (createErr) {
        return res.status(404).json({ error: 'MatchData not found and could not create' });
      }
    }
    res.json(matchData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: list matches in a round
app.get('/api/public/rounds/:roundId/matches', async (req, res) => {
  try {
    const Match = require('./models/match.model');
    const matches = await Match.find({ roundId: req.params.roundId });
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: get currently selected match for a tournament + round (fallback to latest by matchNo)
app.get('/api/public/tournaments/:tournamentId/rounds/:roundId/selected-match', async (req, res) => {
  try {
    const { tournamentId, roundId } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(tournamentId) || !mongoose.Types.ObjectId.isValid(roundId)) {
      return res.status(400).json({ error: 'Invalid tournamentId or roundId' });
    }
    const MatchSelection = require('./models/MatchSelection.model');
    const Match = require('./models/match.model');

    const selected = await MatchSelection.findOne({ tournamentId, roundId, isSelected: true })
      .sort({ createdAt: -1 })
      .lean();

    if (selected?.matchId) {
      return res.json({ matchId: selected.matchId.toString() });
    }

    // Fallback: latest match by matchNo
    const latest = await Match.findOne({ tournamentId, roundId }).sort({ matchNo: -1 }).lean();
    if (latest?._id) {
      return res.json({ matchId: latest._id.toString() });
    }

    return res.status(404).json({ error: 'No selected match or matches found' });
  } catch (err) {
    console.error('Public selected-match error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Public overall aggregated data for a round in a tournament
app.get('/api/public/tournaments/:tournamentId/rounds/:roundId/overall', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Match = require('./models/match.model');
    const MatchData = require('./models/matchData.model');
    const Round = require('./models/round.model');
    const { createMatchDataForMatchDoc } = require('./controller/matchData.controller');

    const { tournamentId, roundId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tournamentId) || !mongoose.Types.ObjectId.isValid(roundId)) {
      return res.status(400).json({ error: 'Invalid tournamentId or roundId' });
    }

    const round = await Round.findOne({ _id: roundId, tournamentId });
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const matches = await Match.find({ tournamentId, roundId }).sort({ matchNo: 1 }).lean();
    if (!matches || matches.length === 0) {
      return res.json({ tournamentId, roundId, teams: [], createdAt: new Date() });
    }

    // Use all matches in the round for overall data
    const filteredMatches = matches;

    // helpers
    const NUMERIC_PLAYER_FIELDS = [
      'health','healthMax','liveState','killNum','killNumBeforeDie','gotAirDropNum','maxKillDistance','damage',
      'killNumInVehicle','killNumByGrenade','AIKillNum','BossKillNum','rank','inDamage','headShotNum','survivalTime',
      'driveDistance','marchDistance','assists','outsideBlueCircleTime','knockouts','rescueTimes','useSmokeGrenadeNum',
      'useFragGrenadeNum','useBurnGrenadeNum','useFlashGrenadeNum','PoisonTotalDamage','UseSelfRescueTime',
      'UseEmergencyCallTime','contribution'
    ];
    function sumNumericFields(target, source, fields) {
      for (const f of fields) {
        const a = Number(target[f] || 0);
        const b = Number(source[f] || 0);
        target[f] = a + b;
      }
    }
    function buildInitialAggPlayer(p) {
      return {
        uId: p.uId || '',
        _id: p._id,
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
        contribution: 0
      };
    }

    // load matchDatas using pattern similar to public matchdata route
    const teamsMap = new Map();

    for (const m of filteredMatches) {
      let matchData = await MatchData.findOne({ matchId: m._id, userId: m.userId }).lean();
      if (!matchData) {
        matchData = await MatchData.findOne({ matchId: m._id }).lean();
      }
      if (!matchData) {
        try {
          const created = await createMatchDataForMatchDoc(m._id);
          matchData = created && created.toObject ? created.toObject() : created;
        } catch (e) {
          // skip if cannot create
          continue;
        }
      }
      if (!matchData) continue;

      for (const team of matchData.teams || []) {
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
            players: new Map()
          });
        }
        const aggTeam = teamsMap.get(teamKey);
        if (!aggTeam.teamName && team.teamName) aggTeam.teamName = team.teamName;
        if (!aggTeam.teamTag && team.teamTag) aggTeam.teamTag = team.teamTag;
        if (!aggTeam.teamLogo && team.teamLogo) aggTeam.teamLogo = team.teamLogo;
        if (Number.isFinite(team.slot)) {
          aggTeam.slot = Math.min(aggTeam.slot || team.slot, team.slot);
        }
        aggTeam.placePoints += Number(team.placePoints || 0);
        if (Number(team.placePoints || 0) === 10) aggTeam.wwcd += 1;

        for (const p of team.players || []) {
          const pKey = p._id.toString();
          if (!aggTeam.players.has(pKey)) {
            aggTeam.players.set(pKey, buildInitialAggPlayer(p));
          }
          const aggPlayer = aggTeam.players.get(pKey);

          if (p.playerName) aggPlayer.playerName = p.playerName;
          if (p.picUrl) aggPlayer.picUrl = p.picUrl;
          if (p.showPicUrl) aggPlayer.showPicUrl = p.showPicUrl;
          if (p.character) aggPlayer.character = p.character;
          if (p.playerOpenId) aggPlayer.playerOpenId = p.playerOpenId;
          if (p.uId) aggPlayer.uId = p.uId;
          if (p.teamIdfromApi) aggPlayer.teamIdfromApi = p.teamIdfromApi;

          sumNumericFields(aggPlayer, p, NUMERIC_PLAYER_FIELDS);
        }
      }
    }

    const aggregatedTeams = Array.from(teamsMap.values()).map(t => ({
      teamId: t.teamId,
      teamName: t.teamName,
      teamTag: t.teamTag,
      teamLogo: t.teamLogo,
      slot: t.slot || 0,
      placePoints: t.placePoints,
      wwcd: t.wwcd,
      players: Array.from(t.players.values())
    })).sort((a, b) => (a.slot || 0) - (b.slot || 0));

    return res.json({ tournamentId, roundId, teams: aggregatedTeams, createdAt: new Date() });
  } catch (err) {
    console.error('Public overall error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World from Express!');
});

// --- SOCKET.IO ---
const server = http.createServer(app);
const io = initializeSocket(server);

// Wrap session middleware for socket.io
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.on('connection', (socket) => {
  console.log('WebSocket client connected:', socket.id);

  // Join user-specific room if user is authenticated
  if (socket.request.session?.userId) {
    socket.join(socket.request.session.userId);
    console.log(`User ${socket.request.session.userId} joined their room`);
  }

  socket.on('message', (msg) => {
    console.log('Received message:', msg);
    socket.emit('message', `Server received: ${msg}`);
  });

  // Emit circle info immediately when client connects
  const emitCircleInfoToClient = async () => {
    try {
      const axios = require('axios');
      const PUBG_API_URL = process.env.PUBG_API_URL || 'http://localhost:10086';
      const circleRes = await axios.get(`${PUBG_API_URL}/getcircleinfo`, { timeout: 5000 });
      const circleInfo = circleRes.data.circleInfo || circleRes.data;
      console.log(`Emitting circle info to newly connected client ${socket.id}:`, circleInfo);
      socket.emit('circleInfoUpdate', circleInfo);
    } catch (err) {
      console.warn(`Could not fetch circle info for client ${socket.id}:`, err.code);
    }
  };

  emitCircleInfoToClient();

  socket.on('disconnect', () => {
    console.log('WebSocket client disconnected:', socket.id);
  });
});

// --- START SERVER ---
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  startLiveMatchUpdater();
  startCircleInfoUpdater();
});

