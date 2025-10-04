const express = require('express');
const router = express.Router();
const roundController = require('../controller/round.controller.js');
const requireAuth = require('../authMiddleware.js');

router.post('/tournaments/:tournamentId/rounds', requireAuth, roundController.createRoundInTournament);
router.get('/tournaments/:tournamentId/rounds', requireAuth, roundController.getRoundsByTournamentId);
router.get('/tournaments/:tournamentId/rounds/:id', requireAuth, roundController.getRoundById);
router.put('/tournaments/:tournamentId/rounds/:id', requireAuth, roundController.updateRound);
router.delete('/tournaments/:tournamentId/rounds/:id', requireAuth, roundController.deleteRound);
router.get('/rounds', requireAuth, roundController.getAllRounds)
router.get('/user/rounds', requireAuth, roundController.getRoundsByUser);
module.exports = router;
