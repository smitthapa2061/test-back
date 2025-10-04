const mongoose = require('mongoose');

const matchSelectionSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true
    },
    roundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Round',
      required: true
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true
    },
    isSelected: {
      type: Boolean,
      default: false
    },
    isPollingActive: { // <-- new field
      type: Boolean,
      default: false
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    },
     userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } // <-- owner (session user)
  },
  { versionKey: false }
);

module.exports = mongoose.models.MatchSelection || mongoose.model('MatchSelection', matchSelectionSchema);
