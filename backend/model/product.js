const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true },
  selector: { type: String, required: true },
  price: Number,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

module.exports = mongoose.model('Product', ProductSchema);
