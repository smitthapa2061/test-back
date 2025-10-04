const MatchSelection = require('../models/MatchSelection.model.js');
const { getSocket } = require('../socket'); // Socket.IO singleton

// Get all matches where isSelected = true for this user
const getAllSelectedMatches = async (req, res) => {
  try {
    const userId = req.session.userId;
    const selectedMatches = await MatchSelection.find({ isSelected: true, userId });

    if (selectedMatches.length === 0) {
      return res.status(404).json({ message: 'No selected matches found for this user' });
    }

    res.status(200).json(selectedMatches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Select / Deselect a match (user-based)
const selectMatch = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { tournamentId, roundId, matchId } = req.body;

    if (!tournamentId || !roundId || !matchId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const io = getSocket();

    // Check if this match is already selected by this user
    const alreadySelected = await MatchSelection.findOne({
      tournamentId,
      roundId,
      matchId,
      userId,
      isSelected: true,
    });

    if (alreadySelected) {
      // Deselect it
      await MatchSelection.updateOne(
        { tournamentId, roundId, matchId, userId },
        { $set: { isSelected: false } }
      );

      io.emit('matchDeselected', { matchId, tournamentId, roundId, userId });

      return res.status(200).json({ message: 'Match deselected', deselected: matchId });
    }

    // Clear previous selection for this tournament & round for this user
    await MatchSelection.updateMany(
      { tournamentId, roundId, userId },
      { $set: { isSelected: false } }
    );

    // Set the new selection
    const selected = await MatchSelection.findOneAndUpdate(
      { tournamentId, roundId, matchId, userId },
      { $set: { isSelected: true } },
      { upsert: true, new: true }
    );

    io.emit('matchSelected', { selected });

    res.status(200).json({ message: 'Match selected', selected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get currently selected match for a tournament & round (user-based)
const getSelectedMatch = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { tournamentId, roundId } = req.params;

    if (!tournamentId || !roundId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const selected = await MatchSelection.findOne({
      tournamentId,
      roundId,
      userId,
      isSelected: true
    });

    if (!selected) {
      return res.status(404).json({ message: 'No match selected for this user' });
    }

    res.status(200).json(selected);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all selections for a tournament & round (user-based)
const getAllSelections = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { tournamentId, roundId } = req.params;

    if (!tournamentId || !roundId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const selections = await MatchSelection.find({ tournamentId, roundId, userId });
    res.status(200).json(selections);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete a match selection by matchId (user-based)
const deleteMatchSelection = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ message: 'Missing required matchId' });
    }

    const result = await MatchSelection.findOneAndDelete({ matchId, userId });

    if (!result) {
      return res.status(404).json({ message: 'Match selection not found for this user' });
    }

    const io = getSocket();
    io.emit('matchDeleted', { matchId, userId });

    res.status(200).json({ message: 'Match selection deleted successfully', result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  selectMatch,
  getSelectedMatch,
  getAllSelections,
  getAllSelectedMatches,
  deleteMatchSelection
};
