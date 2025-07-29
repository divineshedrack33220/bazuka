const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be an integer',
    },
  },
  productDetails: {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    images: [{ type: String }], // Array of image URLs
  },
});

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    sessionId: {
      type: String,
      required: function () {
        return !this.userId; // sessionId required only if userId is not set
      },
    },
    items: [cartItemSchema],
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
    toJSON: { virtuals: true }, // Include virtuals in JSON output
    toObject: { virtuals: true },
  }
);

// Indexes for performance
cartSchema.index({ userId: 1 }, { sparse: true }); // Index for user-based carts
cartSchema.index({ sessionId: 1 }, { sparse: true }); // Index for session-based carts

// Pre-save hook to ensure either userId or sessionId is set
cartSchema.pre('save', function (next) {
  if (!this.userId && !this.sessionId) {
    return next(new Error('Either userId or sessionId must be provided'));
  }
  next();
});

// Method to populate product details in cart items
cartSchema.methods.populateProductDetails = async function () {
  const Product = mongoose.model('Product');
  for (let item of this.items) {
    if (!item.productDetails.name) {
      const product = await Product.findById(item.productId).select('name price images');
      if (product) {
        item.productDetails = {
          name: product.name,
          price: product.price,
          images: product.images || [],
        };
      }
    }
  }
  return this;
};

// Virtual to format cart response for frontend
cartSchema.virtual('formattedItems').get(function () {
  return this.items.map(item => ({
    product: {
      _id: item.productId,
      name: item.productDetails.name,
      price: item.productDetails.price,
      images: item.productDetails.images,
    },
    quantity: item.quantity,
  }));
});

module.exports = mongoose.model('Cart', cartSchema);