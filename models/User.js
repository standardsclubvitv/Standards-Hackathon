const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  regno: String,
  phone: String,
  email: { type: String, unique: true },
  hostelBlock: String,
  gender: String,
  password: String,
  verified: { type: Boolean, default: false },
  otp: String,
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null }
});

module.exports = mongoose.model('User', userSchema);
