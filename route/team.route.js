const express = require('express');
const router = express.Router();
const teamController = require('../controller/teams.controller.js');

// Create a new team
router.post('/teams', teamController.createTeam);

// Get all teams
router.get('/teams', teamController.getAllTeams);

// Get a team by ID
router.get('/teams/:id', teamController.getTeamById);

// Update a team by ID
router.put('/teams/:id', teamController.updateTeam);

// Delete a team by ID
router.delete('/teams/:id', teamController.deleteTeam);

// Add a player to a team
router.post('/teams/:id/players', teamController.addPlayerToTeam);

// Remove a player from a team by player subdocument ID
router.delete('/teams/:id/players/:playerId', teamController.removePlayerFromTeam);

router.delete(
  "/teams/:id/players",
  teamController.removeMultiplePlayersFromTeam
);

module.exports = router;
