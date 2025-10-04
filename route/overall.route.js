const express = require('express');
const router = express.Router();

const requireAuth = require('../authMiddleware.js');
const { getOverallMatchDataForRound } = require('../controller/overall.controller.js');

// GET overall aggregated match data for a given tournament and round
// Mirrors matchData response structure but aggregated across all matches in the round
router.get(
  '/tournament/:tournamentId/round/:roundId/overall',
  requireAuth,
  getOverallMatchDataForRound
);

module.exports = router;
