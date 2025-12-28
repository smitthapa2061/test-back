const mongoose = require('mongoose');

const backpackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  PlayerKey: { type: Number, required: true },
  TeamID: { type: Number, required: true },
  MainWeapon1ID: { type: Number },
  MainWeapon1AmmoNuminClip: { type: Number },
  MainWeapon2ID: { type: Number },
  MainWeapon2AmmoNuminClip: { type: Number },
  // Additional item fields as mixed type for dynamic item IDs
}, { strict: false, timestamps: true });

const getBackpackModel = (matchDataId) => {
  const collectionName = `backpack_${matchDataId}`;
  return mongoose.models[collectionName] || mongoose.model(collectionName, backpackSchema);
};

module.exports = { getBackpackModel };