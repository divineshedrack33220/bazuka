const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  iconPath: { type: String, required: true },
});

module.exports = mongoose.model('Promo', promoSchema);