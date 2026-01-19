// routes/match.routes.js
const express = require('express');
const router = express.Router();
const matchController = require('../controller/match.controller.js');
const requireAuth = require('../authMiddleware.js'); // ✅ import middleware

// Create a match inside specific tournament and round
router.post(
  '/tournaments/:tournamentId/rounds/:roundId/matches',
  requireAuth,
  matchController.createMatchInRoundInTournament
);

// Get match by ID
router.get(
  '/matches/:id',
  requireAuth,
  matchController.getMatchById
);

// Get all matches in a tournament
router.get(
  '/tournaments/:tournamentId/matches',
  requireAuth,
  matchController.getMatchesByTournamentId
);

// Get all matches in a round
router.get(
  '/rounds/:roundId/matches',
  requireAuth,
  matchController.getMatchesByRoundId
);

// Get matches by tournament AND round
router.get(
  '/tournaments/:tournamentId/rounds/:roundId/matches',
  requireAuth,
  matchController.getMatchesByTournamentAndRound
);

// Update a match
router.put(
  '/tournaments/:tournamentId/rounds/:roundId/matches/:id',
  requireAuth,
  matchController.updateMatch
);

// Delete a match
router.delete(
  '/tournaments/:tournamentId/rounds/:roundId/matches/:id',
  requireAuth,
  matchController.deleteMatch
);

module.exports = router;
