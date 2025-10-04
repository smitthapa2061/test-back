const express = require('express');
const router = express.Router();
const groupController = require('../controller/group.controller.js');
const requireAuth = require('../authMiddleware.js');

// Create group in a tournament
router.post('/tournaments/:tournamentId/groups', requireAuth, groupController.createGroup);

// Get all groups in a tournament
router.get('/tournaments/:tournamentId/groups', requireAuth, groupController.getAllGroups);

// Get a specific group by ID inside a tournament
router.get('/tournaments/:tournamentId/groups/:id', requireAuth, groupController.getGroupById);

// Update a group in a tournament
router.put('/tournaments/:tournamentId/groups/:id', requireAuth, groupController.updateGroup);

// Delete a group in a tournament
router.delete('/tournaments/:tournamentId/groups/:id', requireAuth, groupController.deleteGroup);

module.exports = router;
