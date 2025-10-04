const express = require('express');
const router = express.Router();
const tournamentController = require('../controller/tournament.controller.js');
const requireAuth = require('../authMiddleware.js'); // your session auth

// Specific routes first
// Put '/' route BEFORE '/:id'
router.get('/', requireAuth, tournamentController.getTournaments);
router.post('/', requireAuth, tournamentController.createTournament);
router.get('/name/:name', requireAuth, tournamentController.getTournamentByName);
router.get('/rounds/:tournamentId', requireAuth, tournamentController.getRoundsByTournamentId);
router.get('/:id', requireAuth, tournamentController.getTournamentById);
router.put('/:id', requireAuth, tournamentController.updateTournament);
router.delete('/:id', requireAuth, tournamentController.deleteTournament);

module.exports = router;
