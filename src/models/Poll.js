const mongoose = require('mongoose');

const PollSchema = new mongoose.Schema({
  title: { type: String, required: true },
  options: [
    {
      text: { type: String, required: true },
      votes: { type: Number, default: 0 }
    }
  ],
  isAnonymous: { type: Boolean, default: false },
  endTime: { type: Date, required: true },
  creatorId: { type: String, required: true },
  voters: { type: [String], default: [] },
  editVersion: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Poll', PollSchema);