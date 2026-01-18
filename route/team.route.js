const express = require('express');
const router = express.Router();
const teamController = require('../controller/teams.controller.js');
const { cacheMiddleware, invalidateCacheMiddleware } = require('../middleware/cache.js');

// Create a new team
router.post('/teams', invalidateCacheMiddleware(['cache:/api/teams']), teamController.createTeam);

// Get all teams
router.get('/teams', cacheMiddleware(), teamController.getAllTeams);

// Get a team by ID
router.get('/teams/:id', cacheMiddleware(), teamController.getTeamById);

// Update a team by ID
router.put('/teams/:id', invalidateCacheMiddleware(['cache:/api/teams']), teamController.updateTeam);

// Delete a team by ID
router.delete('/teams/:id', invalidateCacheMiddleware(['cache:/api/teams']), teamController.deleteTeam);

// Add a player to a team
router.post('/teams/:id/players', invalidateCacheMiddleware(['cache:/api/teams']), teamController.addPlayerToTeam);

// Remove a player from a team by player subdocument ID
router.delete('/teams/:id/players/:playerId', invalidateCacheMiddleware(['cache:/api/teams']), teamController.removePlayerFromTeam);

router.delete(
  "/teams/:id/players",
  invalidateCacheMiddleware(['cache:/api/teams']),
  teamController.removeMultiplePlayersFromTeam
);

module.exports = router;
