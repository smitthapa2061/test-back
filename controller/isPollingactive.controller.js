const MatchSelection = require('../models/MatchSelection.model.js');
const mongoose = require('mongoose');
const { getSocket } = require('../socket.js'); // ✅ updated import

// GET isPollingActive for a match (user-based)
const getPollingStatus = async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid matchId' });
    }

    const selection = await MatchSelection.findOne({ matchId, userId });
    if (!selection) {
      return res.status(404).json({ message: 'MatchSelection not found' });
    }

    res.status(200).json({ matchId, isPollingActive: selection.isPollingActive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PATCH update isPollingActive for a specific match, round, and tournament (user-based)
const updatePollingStatus = async (req, res) => {
  try {
    const { matchId, roundId, tournamentId } = req.params;
    const { isPollingActive } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(matchId) ||
        !mongoose.Types.ObjectId.isValid(roundId) ||
        !mongoose.Types.ObjectId.isValid(tournamentId)) {
      return res.status(400).json({ message: 'Invalid matchId, roundId, or tournamentId' });
    }

    if (typeof isPollingActive !== 'boolean') {
      return res.status(400).json({ message: 'isPollingActive must be a boolean' });
    }

    // Disable polling for all other matches of this user in the same round & tournament
    if (isPollingActive) {
      await MatchSelection.updateMany(
        { tournamentId, roundId, matchId: { $ne: matchId }, userId },
        { $set: { isPollingActive: false } }
      );
    }

    // Update the specific match selection for this user
    const updatedSelection = await MatchSelection.findOneAndUpdate(
      { matchId, roundId, tournamentId, userId },
      { $set: { isPollingActive } },
      { new: true, upsert: true }
    );

    if (!updatedSelection) {
      return res.status(404).json({ message: 'MatchSelection not found' });
    }

    // --- Emit WebSocket event ---
    const io = getSocket();
    io.to(userId).emit('pollingStatusUpdated', { // emit to user-specific room
      _id: updatedSelection._id,
      matchId,
      roundId,
      tournamentId,
      isPollingActive: updatedSelection.isPollingActive
    });

    res.status(200).json({
      message: 'Polling status updated',
      tournamentId,
      roundId,
      matchId,
      isPollingActive: updatedSelection.isPollingActive
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getPollingStatus,
  updatePollingStatus
};
