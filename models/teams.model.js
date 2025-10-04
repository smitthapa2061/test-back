// models/teams.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PlayerSchema = new Schema({
  playerName: { type: String, required: true },
  playerId: { type: String },
  photo: { type: String },
  hiddenBy: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }], // per-user hidden flag
});

const TeamSchema = new Schema({
  teamFullName: { type: String, required: true },
  teamTag: { type: String, required: true },
  logo: { type: String },
  hiddenBy: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }], // per-user hidden flag for team
  players: [PlayerSchema], // ⬅️ subdocuments, not just plain objects
});

module.exports = mongoose.model('Team', TeamSchema);
