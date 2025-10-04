const mongoose = require('mongoose');
const Round = require('../models/round.model');
const Group = require('../models/group.model');
const Match = require('../models/match.model');

// ---------------- CREATE ROUND ----------------
const createRoundInTournament = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tournamentId } = req.params;
    const { roundName, torLogo, day, groups, apiEnable } = req.body;
    const createdBy = req.session.userId;

    if (!createdBy) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (apiEnable === true) {
      // Disable apiEnable for all rounds owned by this user
      await Round.updateMany({ createdBy }, { $set: { apiEnable: false } }, { session });
    }

    const newRound = await Round.create(
      [
        {
          tournamentId,
          roundName,
          torLogo,
          day,
          groups,
          apiEnable: !!apiEnable,
          createdBy,
        },
      ],
      { session }
    );

    const savedRound = newRound[0];

    if (Array.isArray(groups) && groups.length > 0) {
      await Group.updateMany(
        { _id: { $in: groups } },
        { $set: { roundId: savedRound._id } },
        { session }
      );

      await Match.updateMany(
        { roundId: savedRound._id },
        { $addToSet: { groups: { $each: groups } } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(savedRound);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Error creating round', error: err.message });
  }
};

// ---------------- GET ROUND BY ID ----------------
const getRoundById = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const round = await Round.findOne({ _id: req.params.id, createdBy: userId })
      .populate({ path: 'groups', populate: { path: 'slots.team' } });

    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }

    res.json(round);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------- GET ROUNDS BY TOURNAMENT ----------------
const getRoundsByTournamentId = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rounds = await Round.find({ tournamentId: req.params.tournamentId, createdBy: userId })
      .populate({ path: 'groups', populate: { path: 'slots.team' } })
      .sort({ createdAt: -1 });

    res.json(rounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------- GET ROUNDS BY USER ----------------
const getRoundsByUser = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rounds = await Round.find({ createdBy: userId })
      .populate({ path: 'groups', populate: { path: 'slots.team' } })
      .sort({ createdAt: -1 });

    res.json(rounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------- UPDATE ROUND ----------------
const updateRound = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tournamentId, id } = req.params;
    const updateData = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Only allow user who created the round
    const round = await Round.findOne({ _id: id, tournamentId, createdBy: userId }).session(session);
    if (!round) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ error: 'You are not allowed to update this round' });
    }

    if (updateData.apiEnable === true) {
      await Round.updateMany(
        { createdBy: userId, _id: { $ne: id } },
        { $set: { apiEnable: false } },
        { session }
      );
    }

    Object.assign(round, updateData);
    const updatedRound = await round.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json(updatedRound);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ error: err.message });
  }
};

// ---------------- DELETE ROUND ----------------
const deleteRound = async (req, res) => {
  try {
    const { tournamentId, id } = req.params;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Only allow deletion if the user created it
    const round = await Round.findOneAndDelete({ _id: id, tournamentId, createdBy: userId });
    if (!round) return res.status(403).json({ error: 'You are not allowed to delete this round' });

    res.json({ message: 'Round deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------- GET ALL ROUNDS (USER-BASED) ----------------
const getAllRounds = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rounds = await Round.find({ createdBy: userId })
      .populate({ path: 'groups', populate: { path: 'slots.team' } })
      .sort({ createdAt: -1 });

    res.json(rounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createRoundInTournament,
  getRoundById,
  getRoundsByTournamentId,
  getRoundsByUser,
  updateRound,
  deleteRound,
  getAllRounds,
};
