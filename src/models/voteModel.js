const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  city: String,
  country: String,
  latitude: Number,
  longitude: Number
}, { _id: false });

const voteSchema = new mongoose.Schema({
  pollId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  optionIndex: {
    type: Number,
    required: true
  },
  voter: {
    type: String,
    required: true
  },
  optionText: String,
  location: locationSchema,  // Use the defined schema
  createdAt: {
    type: Date,
    default: Date.now
  }
});

voteSchema.index({ pollId: 1, voter: 1 });

const Vote = mongoose.model('Vote', voteSchema);

module.exports = Vote;