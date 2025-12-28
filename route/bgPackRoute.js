const express = require('express');
const router = express.Router();
const requireAuth = require('../authMiddleware');
const {
  fetchBackpackInfo,
  getBackpack,
  createBackpackItem,
  updateBackpackItem,
  deleteBackpackItem
} = require('../controller/Api_controllers/bagpackInfocontroller');

// Apply authentication to all routes
router.use(requireAuth);

// Route to fetch backpack info from external API and store in DB
router.get('/fetch/tournament/:tournamentId/round/:roundId/match/:matchId/matchdata/:matchDataId', fetchBackpackInfo);

// Route to get backpack data for a matchData
router.get('/tournament/:tournamentId/round/:roundId/match/:matchId/matchdata/:matchDataId', getBackpack);

// Route to create a new backpack item
router.post('/tournament/:tournamentId/round/:roundId/match/:matchId/matchdata/:matchDataId', createBackpackItem);

// Route to update a backpack item
router.put('/tournament/:tournamentId/round/:roundId/match/:matchId/matchdata/:matchDataId/:id', updateBackpackItem);

// Route to delete a backpack item
router.delete('/tournament/:tournamentId/round/:roundId/match/:matchId/matchdata/:matchDataId/:id', deleteBackpackItem);

module.exports = router;