const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true }, // Changed to String
  sessionId: { type: String }, // For non-authenticated users
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  notes: { type: String, default: '' },
  payment: { type: String, required: true, enum: ['cash', 'bank_transfer'] },
  products: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  }],
  subtotal: { type: Number, required: true, min: 0 },
  deliveryFee: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  status: { type: String, default: 'Pending', enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] },
  confirmed: { type: Boolean, default: false },
  proofOfPayment: { type: String }, // Renamed to match your schema
  createdAt: { type: Date, default: Date.now },
});

// Add indexes for better query performance
orderSchema.index({ userId: 1 });
orderSchema.index({ sessionId: 1 }, { sparse: true });

module.exports = mongoose.model('Order', orderSchema);