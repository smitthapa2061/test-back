const Team = require('../models/teams.model.js');

// Default assets
const DEFAULT_TEAM_LOGO = 'https://res.cloudinary.com/dqckienxj/image/upload/v1759393783/default1_ypnvsb.png';
const DEFAULT_PLAYER_PHOTO = 'https://res.cloudinary.com/dqckienxj/image/upload/v1727161666/defult_chach_apsjhc.png';

// Create a new team
const createTeam = async (req, res) => {
  try {
    const { teamFullName, teamTag, logo, players } = req.body;
    if (!teamFullName || !teamTag) {
      return res.status(400).json({ error: 'Team full name and tag are required' });
    }

    // Use default logo if none provided
    const finalLogo = (typeof logo === 'string' && logo.trim()) ? logo : DEFAULT_TEAM_LOGO;

    // Normalize players, defaulting missing photos
    const normalizedPlayers = Array.isArray(players)
      ? players.map((p) => ({
          ...p,
          photo: (p && typeof p.photo === 'string' && p.photo.trim()) ? p.photo : DEFAULT_PLAYER_PHOTO,
        }))
      : [];

    const team = new Team({
      teamFullName,
      teamTag,
      logo: finalLogo,
      players: normalizedPlayers,
    });
    const savedTeam = await team.save();
    res.status(201).json(savedTeam.toObject()); // Convert to plain object for faster response
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
// Get team by ID
const getTeamById = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).lean(); // Use lean() for faster queries
    if (!team) return res.status(404).json({ error: 'Team not found' });
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all teams
const getAllTeams = async (req, res) => {
  try {
    const teams = await Team.find().lean(); // Use lean() for faster queries
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update team info (including players)
const updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const { teamFullName, teamTag, logo, players } = req.body;

    if (teamFullName) team.teamFullName = teamFullName;
    if (teamTag) team.teamTag = teamTag;
    if (logo !== undefined) team.logo = logo; // update logo
    if (players) team.players = players;

    const updatedTeam = await team.save();
    res.json(updatedTeam.toObject()); // Convert to plain object for faster response
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete team by ID
const deleteTeam = async (req, res) => {
  try {
    const deleted = await Team.findByIdAndDelete(req.params.id).lean(); // Use lean() for faster queries
    if (!deleted) return res.status(404).json({ error: 'Team not found' });
    res.json({ message: 'Team deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add a player to a team
const addPlayerToTeam = async (req, res) => {
  try {
    const { id } = req.params; // team id
    const { playerName, playerId, photo } = req.body;

    // Default player photo if not provided
    const finalPhoto = (typeof photo === 'string' && photo.trim()) ? photo : DEFAULT_PLAYER_PHOTO;

    if (!playerName) return res.status(400).json({ error: 'Player name is required' });

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    team.players.push({ playerName, playerId, photo: finalPhoto });
    await team.save();

    res.status(201).json(team.toObject()); // Convert to plain object for faster response
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Remove player from team by player ID (_id of player subdocument)
// Remove player from team by player ID (_id of player subdocument)
const removePlayerFromTeam = async (req, res) => {
  try {
    const { id, playerId } = req.params;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Remove player by subdocument _id
    team.players.pull({ _id: playerId }); // ⬅️ this replaces player.remove()
    await team.save();

    res.json({ message: 'Player removed successfully', team: team.toObject() }); // Convert to plain object for faster response
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// controllers/teams.controller.js

// Delete multiple players from a team
const removeMultiplePlayersFromTeam = async (req, res) => {
  try {
    const { id } = req.params; // team id
    const { playerIds } = req.body; // array of player _id

    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ error: "playerIds array is required" });
    }

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Remove all players whose _id is in playerIds
    team.players = team.players.filter((p) => !playerIds.includes(p._id.toString()));

    await team.save();

    res.json({ message: "Players removed successfully", team: team.toObject() }); // Convert to plain object for faster response
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



module.exports = {
  createTeam,
  getAllTeams,     // <-- this must be exported and defined
  getTeamById,
  updateTeam,
  deleteTeam,
  addPlayerToTeam,
  removePlayerFromTeam,
  removeMultiplePlayersFromTeam
};
