const express = require('express');
const router = express.Router();
const roundController = require('../controller/round.controller.js');
const requireAuth = require('../authMiddleware.js');
const { cacheMiddleware, invalidateCacheMiddleware } = require('../middleware/cache.js');

router.post('/tournaments/:tournamentId/rounds', requireAuth, roundController.createRoundInTournament);
router.get('/tournaments/:tournamentId/rounds', requireAuth, cacheMiddleware(), roundController.getRoundsByTournamentId);
router.get('/tournaments/:tournamentId/rounds/:id', requireAuth, cacheMiddleware(), roundController.getRoundById);
router.put('/tournaments/:tournamentId/rounds/:id', requireAuth, invalidateCacheMiddleware((req) => ['cache:/api/rounds', 'cache:/api/tournaments/' + req.params.tournamentId + '/rounds', 'cache:/api/public/tournaments/' + req.params.tournamentId + '/rounds/' + req.params.id]), roundController.updateRound);
router.delete('/tournaments/:tournamentId/rounds/:id', requireAuth, invalidateCacheMiddleware((req) => ['cache:/api/rounds', 'cache:/api/tournaments/' + req.params.tournamentId + '/rounds', 'cache:/api/public/tournaments/' + req.params.tournamentId + '/rounds/' + req.params.id]), roundController.deleteRound);
router.get('/rounds', requireAuth, cacheMiddleware(), roundController.getAllRounds)
router.get('/user/rounds', requireAuth, cacheMiddleware(), roundController.getRoundsByUser);
module.exports = router;
