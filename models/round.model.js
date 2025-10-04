const mongoose = require('mongoose');

const roundSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  roundName: { type: String, required: true },
  apiEnable: { type: Boolean, default: false },
  day: { type: String },
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }], // array of group ObjectIds
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } // <-- user who created this round
}, { timestamps: true });

module.exports = mongoose.model('Round', roundSchema);
