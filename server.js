const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');
const validator = require('validator');
const he = require('he');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const checkoutRouter = express.Router();
dotenv.config();

mongoose.set('strictQuery', true);

const app = express();

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Telegram Bot Setup
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '7944192630:AAFL6qpX7YWosaL4osA5nmo4APTaUnYeFZo', { polling: true });
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID || '7285227786');
const ITEMS_PER_PAGE = 5;
const MAX_PRODUCT_IMAGES = 6;

// Track processed message IDs to prevent duplicates
const processedMessages = new Set();

// Models
let Product, Category, Order, Testimonial, NewsletterSubscriber, Visitor, BotState, User;
try {
  User = mongoose.model(
    'User',
    new mongoose.Schema({
     chatId: { type: String, required: true, unique: true }, // Store UUID here
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String },
    updatedAt: { type: Date, default: Date.now },
    })
  );
  Product = mongoose.model(
    'Product',
    new mongoose.Schema({
      name: { type: String, required: true },
      price: { type: Number, required: true },
      description: { type: String, required: true },
      images: [{ type: String }], // Array of image URLs
      isBestseller: { type: Boolean, default: false },
      categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    })
  );
  Category = mongoose.model(
    'Category',
    new mongoose.Schema({
      name: { type: String, required: true },
      image: { type: String },
    })
  );

 Order = mongoose.model(
    'Order',
    new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true, min: 1 },
      }],
      total: { type: Number, required: true, min: 0 },
      status: { type: String, default: 'Pending', enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] },
      createdAt: { type: Date, default: Date.now },
      payment: { type: String, enum: ['cash', 'bank_transfer'], default: 'cash' }, // Added for payment method
      proofOfPayment: { type: String }, // Added for payment proof image path
      sessionId: { type: String }, // Added for non-authenticated users
      name: { type: String, required: true }, // Added for checkout compatibility
      email: { type: String, required: true }, // Added for checkout compatibility
      phone: { type: String, required: true }, // Added for checkout compatibility
      address: { type: String, required: true }, // Added for checkout compatibility
      notes: { type: String, default: '' }, // Added for checkout compatibility
      subtotal: { type: Number, required: true, min: 0 }, // Added for checkout compatibility
      deliveryFee: { type: Number, required: true, min: 0 }, // Added for checkout compatibility
      confirmed: { type: Boolean, default: false }, // Added for checkout compatibility
    })
);


Testimonial = mongoose.model(
  'Testimonial',
  new mongoose.Schema({
   userId: { type: String, ref: 'User', required: true },
  name: { type: String, required: true }, // Stores testimonial-specific name
  text: { type: String, required: true },
  profileImage: { type: String, default: null },
  rating: { type: Number, min: 1, max: 5, default: 5 },
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  })
);
NewsletterSubscriber = mongoose.model(
  'NewsletterSubscriber',
  new mongoose.Schema({
    email: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    subscribedAt: { type: Date, default: () => new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }) },
  })
);
  Visitor = mongoose.model(
    'Visitor',
    new mongoose.Schema({
      ip: { type: String },
      userAgent: { type: String },
      path: { type: String },
      visitedAt: { type: Date, default: Date.now },
    })
  );
  BotState = mongoose.model(
    'BotState',
    new mongoose.Schema({
      chatId: { type: String, required: true, unique: true },
      state: { type: String, default: 'idle' },
      data: { type: mongoose.Schema.Types.Mixed, default: {} },
      updatedAt: { type: Date, default: Date.now },
    })
  );
} catch (error) {
  console.error('Error loading models:', error.message);
  process.exit(1);
}
// Add to the Models section, below existing models
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
        return !this.userId;
      },
    },
    items: [{
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
        images: [{ type: String }],
      },
    }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

cartSchema.index({ userId: 1 }, { sparse: true });
cartSchema.index({ sessionId: 1 }, { sparse: true });

cartSchema.pre('save', function (next) {
  if (!this.userId && !this.sessionId) {
    return next(new Error('Either userId or sessionId must be provided'));
  }
  next();
});

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

cartSchema.virtual('formattedItems').get(function () {
  return this.items.map(item => ({
    product: {
      _id: item.productId,
      name: item.productDetails.name,
      price: item.productDetails.price,
      images: item.productDetails.images || [],
    },
    quantity: item.quantity,
  }));
});

const Cart = mongoose.model('Cart', cartSchema);
// Middleware
app.set('trust proxy', 1);
morgan.token('id', (req) => req.id);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ['*', 'data:'],
        connectSrc: ['*'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: { policy: 'credentialless' },
  })
);

app.use(compression());
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' ? 'https://bazuka.onrender.com/' : 'http://localhost:4000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  })
);
app.use(morgan(':id :method :url :status :response-time ms'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: 'mongodb://127.0.0.1:27017/bazuka',
      collectionName: 'sessions',
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);


// General rate limiter for most endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased to 500 to handle frequent /api/categories and /api/products
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
    retryAfter: 900,
  },
  handler: (req, res, next, options) => {
    console.log(`[${req.id}] Rate limit exceeded for key: ${req.user?._id || req.sessionID || req.ip}, URL: ${req.url}`);
    res.status(options.statusCode).set('Retry-After', options.message.retryAfter).json(options.message);
  },
  keyGenerator: (req) => req.user?._id?.toString() || req.sessionID || req.ip, // Use userId or sessionId if available
});

// Lenient rate limiter for high-traffic endpoints like /api/cart
const lenientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500, // Increased to 1500 for /api/cart
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later.',
    retryAfter: 900,
  },
  handler: (req, res, next, options) => {
    console.log(`[${req.id}] Rate limit exceeded for key: ${req.user?._id || req.sessionID || req.ip}, URL: ${req.url}`);
    res.status(options.statusCode).set('Retry-After', options.message.retryAfter).json(options.message);
  },
  keyGenerator: (req) => req.user?._id?.toString() || req.sessionID || req.ip,
});

// Apply rate limiters to specific routes
app.use('/api/cart', lenientLimiter); // High limit for cart operations
app.use('/api/products', generalLimiter);
app.use('/api/categories', generalLimiter);
app.use('/api/testimonials', generalLimiter);
app.use('/api/orders', generalLimiter);
app.use('/api/checkout', generalLimiter);
app.use('/api/newsletter', generalLimiter);
app.use('/api/submit-payment-proof', generalLimiter);

// Cache static assets
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y', // Cache for 1 year
  etag: true, // Enable ETag for 304 responses
}));

// Favicon route (precautionary)
app.get('/favicon.ico', lenientLimiter, (req, res) => {
  res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Apply general limiter to all other routes
app.use(generalLimiter);

app.use(async (req, res, next) => {
  req.id = uuidv4();
  if (!req.session.cart) req.session.cart = []; // Initialize cart

  // Only track visitors for the root path and if not already tracked in this session
  if (req.path === '/' && !req.session.visitorTracked) {
    await Visitor.create({
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
    }).catch(err => console.error(`[${req.id}] Visitor tracking error:`, err.message));
    req.session.visitorTracked = true; // Mark visitor as tracked
  }
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "img-src 'self' https: data:; " +
    "connect-src 'self' http://localhost:4000 https://bazuka.onrender.com/ https://api.opayweb.com; " +
    "frame-src 'self' https://api.opayweb.com"
  );
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

const checkApiKey = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (apiKey !== (process.env.ADMIN_API_KEY || 'your-admin-api-key')) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  next();
};

const isAdmin = (chatId) => chatId === ADMIN_CHAT_ID;

const escapeHtml = (text) => he.encode(String(text));

const formatProduct = (product) => {
  let imageList = product.images.length
    ? product.images.map((img, i) => `Image ${i + 1}: ${escapeHtml(img)}`).join('\n')
    : 'No images';
  return `<b>${escapeHtml(product.name)}</b>\nPrice: ₦${product.price.toFixed(2)}\nDescription: ${escapeHtml(product.description)}\nImages:\n${imageList}\nBestseller: ${product.isBestseller ? 'Yes' : 'No'}\nID: ${product._id}${product.categoryId ? `\nCategory: ${escapeHtml(product.categoryId.name)}` : ''}`;
};

const formatCategory = (category) =>
  `<b>${escapeHtml(category.name)}</b>\n${category.image ? `Image: ${escapeHtml(category.image)}\n` : ''}ID: ${category._id}`;

const getAdminKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🛍️ Product Management', callback_data: 'menu_products' },
        { text: '📋 Category Management', callback_data: 'menu_categories' },
      ],
      [
        { text: '🛒 Orders & Subscribers', callback_data: 'menu_orders' },
        { text: '⭐ Testimonials', callback_data: 'menu_testimonials' },
      ],
    ],
  },
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const text = msg.text || '';

  if (processedMessages.has(messageId)) {
    console.log(`[${chatId}] Skipping duplicate message ID: ${messageId}`);
    return;
  }
  processedMessages.add(messageId);
  if (processedMessages.size > 1000) {
    processedMessages.clear();
  }

  console.log(`[${chatId}] Received message: ${text}, Photo: ${!!msg.photo}, State: ${JSON.stringify(await BotState.findOne({ chatId: chatId.toString() }))}`);

  if (!isAdmin(chatId) && !['/start', '/cancel', '/subscribenewsletter', '/addtestimonial', '/viewtestimonials'].includes(text)) {
    return bot.sendMessage(chatId, 'Unauthorized: Admin only.', { parse_mode: 'HTML' });
  }

  const state = await BotState.findOne({ chatId: chatId.toString() }) || { state: 'idle', data: {} };

  if (text === '/start') {
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'idle', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Welcome to bazuka Admin Bot! 🛠️\nManage products, categories, orders, and more.\nUse /cancel to abort any operation.', {
      parse_mode: 'HTML',
      ...getAdminKeyboard(),
    });
  } else if (text === '/cancel') {
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'idle', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Operation cancelled.', {
      parse_mode: 'HTML',
      ...getAdminKeyboard(),
    });
 } else if (text === '/addtestimonial') {
  try {
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_testimonial_name', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter the name for the testimonial author:', { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[${chatId}] Add testimonial error:`, error);
    bot.sendMessage(chatId, 'Error starting testimonial creation. Please try again.', { parse_mode: 'HTML' });
  }
} else if (text === '/viewtestimonials' || text === 'View Testimonials') {
  try {
    const page = 1;
    const total = await Testimonial.countDocuments({ approved: true });
    const testimonials = await Testimonial.find({ approved: true })
      .sort({ createdAt: -1 })
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);
    if (!testimonials.length) {
      return bot.sendMessage(chatId, 'No approved testimonials found.', { parse_mode: 'HTML' });
    }
    let message = `<b>Testimonials (Page ${page}):</b>\n`;
    testimonials.forEach(t => {
      const name = t.name ? escapeHtml(t.name) : 'Anonymous';
      const stars = '⭐'.repeat(Number(t.rating) || 5);
      message += `<b>Name:</b> ${name}\n<b>Rating:</b> ${stars}\n<b>Text:</b> ${escapeHtml(t.text.substring(0, 200))}...\n${t.profileImage ? `<b>Image:</b> ${escapeHtml(t.profileImage)}\n` : ''}<b>Date:</b> ${t.createdAt.toLocaleDateString()}\n\n`;
    });
    console.log(`[${chatId}] Message length: ${message.length}`);
    const buttons = [];
    if (page * ITEMS_PER_PAGE < total) {
      buttons.push([{ text: '➡️ Next', callback_data: `view_testimonials:${page + 1}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_testimonials' }]);
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error fetching testimonials.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] View testimonials error:`, error);
  }
} else if (state.state === 'add_testimonial_name') {
  if (!isAdmin(chatId)) return;
  if (!text || text.trim().length < 2) {
    return bot.sendMessage(chatId, 'Please enter a valid name (at least 2 characters).', { parse_mode: 'HTML' });
  }
  try {
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_testimonial_text', data: { name: text.trim() }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter the testimonial text:', { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`[${chatId}] Add testimonial name error:`, error);
    bot.sendMessage(chatId, 'Error saving name. Please try again.', { parse_mode: 'HTML' });
  }
} else if (state.state === 'add_testimonial_text') {
  if (!isAdmin(chatId)) return;
  if (!text || text.trim().length < 5) {
    return bot.sendMessage(chatId, 'Please enter valid testimonial text (at least 5 characters).', { parse_mode: 'HTML' });
  }
  await BotState.updateOne(
    { chatId: chatId.toString() },
    { state: 'add_testimonial_rating', data: { ...state.data, text: text.trim() }, updatedAt: Date.now() },
    { upsert: true }
  );
  bot.sendMessage(chatId, 'Enter the rating (1-5):', { parse_mode: 'HTML' });
} else if (state.state === 'add_testimonial_rating') {
  if (!isAdmin(chatId)) return;
  const rating = parseInt(text);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    return bot.sendMessage(chatId, 'Please enter a valid rating (1-5).', { parse_mode: 'HTML' });
  }
  await BotState.updateOne(
    { chatId: chatId.toString() },
    { state: 'add_testimonial_image', data: { ...state.data, rating: Number(rating) }, updatedAt: Date.now() },
    { upsert: true }
  );
  bot.sendMessage(chatId, 'Send an image for the testimonial or type "skip" to finish:', { parse_mode: 'HTML' });
} else if (state.state === 'add_testimonial_image') {
  if (!isAdmin(chatId)) return;
  let profileImage = null;
  if (text.toLowerCase() === 'skip') {
    console.log(`[${chatId}] User skipped testimonial image upload`);
  } else if (msg.photo) {
    console.log(`[${chatId}] Received photo: ${JSON.stringify(msg.photo)}`);
    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileLink = await bot.getFileLink(fileId);
      console.log(`[${chatId}] File link: ${fileLink}`);
      const timestamp = Math.floor(Date.now() / 1000);
      let retries = 3;
      let uploadResult = null;
      while (retries > 0) {
        try {
          uploadResult = await cloudinary.uploader.upload(fileLink, {
            folder: 'testimonials',
            timestamp: timestamp,
            resource_type: 'image',
            transformation: [{ width: 100, height: 100, crop: 'fill', quality: 'auto' }],
          });
          break;
        } catch (uploadError) {
          retries--;
          console.error(`[${chatId}] Testimonial image upload attempt failed (${retries} retries left):`, uploadError);
          if (retries === 0) throw uploadError;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      profileImage = uploadResult.secure_url;
      console.log(`[${chatId}] Testimonial image uploaded to Cloudinary: ${profileImage}`);
    } catch (error) {
      console.error(`[${chatId}] Testimonial image upload error:`, error);
      return bot.sendMessage(chatId, 'Error uploading image. Please try again or type "skip".', { parse_mode: 'HTML' });
    }
  } else {
    console.log(`[${chatId}] Invalid input: Neither photo nor 'skip'`);
    return bot.sendMessage(chatId, 'Invalid input. Please upload a photo or type "skip".', { parse_mode: 'HTML' });
  }
  try {
    if (!state.data.name) {
      console.error(`[${chatId}] Name missing for testimonial creation`);
      return bot.sendMessage(chatId, 'Error: Name missing. Please start over with /addtestimonial.', { parse_mode: 'HTML' });
    }
    const testimonial = await Testimonial.create({
      userId: chatId.toString(),
      name: state.data.name, // Store name directly in Testimonial
      text: state.data.text,
      profileImage,
      rating: Number(state.data.rating) || 5,
      approved: isAdmin(chatId),
      createdAt: Date.now(),
    });
    console.log(`[${chatId}] Testimonial created: ${testimonial._id}, Name: ${testimonial.name}, Rating: ${testimonial.rating}`);
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'idle', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, `Testimonial added by ${escapeHtml(state.data.name)}!`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'menu_testimonials' }]],
      },
    });
  } catch (error) {
    console.error(`[${chatId}] Add testimonial error:`, error);
    bot.sendMessage(chatId, 'Error submitting testimonial.', { parse_mode: 'HTML' });
  }
} else if (text === 'Manage Testimonials') {
  if (!isAdmin(chatId)) return;
  try {
    const page = 1;
    const ITEMS_PER_PAGE = 8;
    const total = await Testimonial.countDocuments();
    const testimonials = await Testimonial.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);
    if (!testimonials.length) {
      return bot.sendMessage(chatId, 'No testimonials found.', { parse_mode: 'HTML' });
    }
    const buttons = [];
    for (let i = 0; i < testimonials.length; i += 2) {
      const row = [
        {
          text: `${escapeHtml(testimonials[i].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i].rating) || 5} ${testimonials[i].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i]._id}:${page}`,
        },
      ];
      if (i + 1 < testimonials.length) {
        row.push({
          text: `${escapeHtml(testimonials[i + 1].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i + 1].rating) || 5} ${testimonials[i + 1].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i + 1]._id}:${page}`,
        });
      }
      buttons.push(row);
    }
    if (page * ITEMS_PER_PAGE < total) {
      buttons.push([{ text: '➡️ Next', callback_data: `manage_testimonials:${page + 1}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_testimonials' }]);
    bot.sendMessage(chatId, `<b>Manage Testimonials (Page ${page})</b>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error fetching testimonials.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Manage testimonials error:`, error);
  }


  

  } else if (text === 'Add Product') {
    if (!isAdmin(chatId)) return;
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_product_name', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter product name:', { parse_mode: 'HTML' });
  } else if (text === 'Manage Products') {
    if (!isAdmin(chatId)) return;
    try {
      const products = await Product.find().populate('categoryId').limit(ITEMS_PER_PAGE);
      if (!products.length) {
        return bot.sendMessage(chatId, 'No products found.', { parse_mode: 'HTML' });
      }
      const buttons = products.map((product) => [
        { text: escapeHtml(product.name), callback_data: `manage_product:${product._id}:1` },
      ]);
      buttons.push([{ text: 'Next', callback_data: `manage_products:2` }]);
      bot.sendMessage(chatId, '<b>Manage Products</b>', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      bot.sendMessage(chatId, 'Error fetching products.', { parse_mode: 'HTML' });
      console.error(`[${chatId}] Manage products error:`, error);
    }
  } else if (text === 'Add Category') {
    if (!isAdmin(chatId)) return;
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_category_name', data: {}, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter category name:', { parse_mode: 'HTML' });
  } else if (text === 'Manage Categories') {
    if (!isAdmin(chatId)) return;
    try {
      const categories = await Category.find().limit(ITEMS_PER_PAGE);
      if (!categories.length) {
        return bot.sendMessage(chatId, 'No categories found.', { parse_mode: 'HTML' });
      }
      const buttons = categories.map((category) => [
        { text: escapeHtml(category.name), callback_data: `manage_category:${category._id}:1` },
      ]);
      buttons.push([{ text: 'Next', callback_data: `manage_categories:2` }]);
      bot.sendMessage(chatId, '<b>Manage Categories</b>', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      bot.sendMessage(chatId, 'Error fetching categories.', { parse_mode: 'HTML' });
      console.error(`[${chatId}] Manage categories error:`, error);
    }
  } else if (text === 'View Orders') {
    if (!isAdmin(chatId)) return;
    try {
      const page = 1;
      const total = await Order.countDocuments();
      const orders = await Order.find()
        .populate('products.productId')
        .populate({ path: 'userId', select: 'name email phone', model: 'User' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE);
      if (!orders.length) {
        return bot.sendMessage(chatId, 'No orders found.', { parse_mode: 'HTML' });
      }
      let message = `<b>Orders (Page ${page}):</b>\n`;
      orders.forEach(order => {
        const total = typeof order.total === 'number' ? order.total.toFixed(2) : 'N/A';
        const userInfo = order.userId
          ? `${escapeHtml(order.userId.name || 'Anonymous')} (${escapeHtml(order.userId.email || 'No email')}${order.userId.phone ? `, ${escapeHtml(order.userId.phone)}` : ''})`
          : 'Unknown User';
        message += `<b>Order ID:</b> ${order._id}\n<b>User:</b> ${userInfo}\n<b>Total:</b> ₦${total}\n<b>Status:</b> ${escapeHtml(order.status)}\n<b>Products:</b>\n`;
        order.products.forEach(p => {
          const productName = p.productId ? escapeHtml(p.productId.name) : 'Unknown Product';
          message += `- ${productName} (Qty: ${p.quantity})\n`;
        });
        message += `<b>Created:</b> ${order.createdAt.toLocaleDateString()}\n\n`;
      });
      console.log(`[${chatId}] Message length: ${message.length}`);
      const buttons = [];
      if (page * ITEMS_PER_PAGE < total) {
        buttons.push([{ text: '➡️ Next', callback_data: `view_orders:${page + 1}` }]);
      }
      buttons.push([{ text: '🔙 Back', callback_data: 'menu_orders' }]);
      bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      bot.sendMessage(chatId, 'Error fetching orders.', { parse_mode: 'HTML' });
      console.error(`[${chatId}] View orders error:`, error);
    }
  } else if (text === 'View Subscribers') {
    if (!isAdmin(chatId)) return;
    try {
      const page = 1;
      const total = await NewsletterSubscriber.countDocuments();
      const subscribers = await NewsletterSubscriber.find()
        .populate({ path: 'userId', select: 'name email phone', model: 'User' })
        .sort({ subscribedAt: -1 })
        .skip((page - 1) * ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE);
      if (!subscribers.length) {
        return bot.sendMessage(chatId, 'No subscribers found.', { parse_mode: 'HTML' });
      }
      let message = `<b>Newsletter Subscribers (Page ${page}):</b>\n`;
      subscribers.forEach(s => {
        const userInfo = s.userId
          ? `${escapeHtml(s.userId.name || 'Anonymous')} (${escapeHtml(s.userId.email || 'No email')}${s.userId.phone ? `, ${escapeHtml(s.userId.phone)}` : ''})`
          : 'Unknown User';
        message += `<b>User:</b> ${userInfo}\n<b>Subscribed:</b> ${s.subscribedAt.toLocaleDateString()}\n\n`;
      });
      console.log(`[${chatId}] Message length: ${message.length}`);
      const buttons = [];
      if (page * ITEMS_PER_PAGE < total) {
        buttons.push([{ text: '➡️ Next', callback_data: `view_subscribers:${page + 1}` }]);
      }
      buttons.push([{ text: '🔙 Back', callback_data: 'menu_orders' }]);
      bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      bot.sendMessage(chatId, 'Error fetching subscribers.', { parse_mode: 'HTML' });
      console.error(`[${chatId}] View subscribers error:`, error);
    }
  } else if (text === 'Manage Testimonials') {
  if (!isAdmin(chatId)) return;
  try {
    const page = 1;
    const ITEMS_PER_PAGE = 8;
    const total = await Testimonial.countDocuments();
    const testimonials = await Testimonial.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);
    if (!testimonials.length) {
      return bot.sendMessage(chatId, 'No testimonials found.', { parse_mode: 'HTML' });
    }
    const buttons = [];
    for (let i = 0; i < testimonials.length; i += 2) {
      const row = [
        {
          text: `${escapeHtml(testimonials[i].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i].rating) || 5} ${testimonials[i].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i]._id}:${page}`,
        },
      ];
      if (i + 1 < testimonials.length) {
        row.push({
          text: `${escapeHtml(testimonials[i + 1].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i + 1].rating) || 5} ${testimonials[i + 1].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i + 1]._id}:${page}`,
        });
      }
      buttons.push(row);
    }
    if (page * ITEMS_PER_PAGE < total) {
      buttons.push([{ text: '➡️ Next', callback_data: `manage_testimonials:${page + 1}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_testimonials' }]);
    bot.sendMessage(chatId, `<b>Manage Testimonials (Page ${page})</b>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error fetching testimonials.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Manage testimonials error:`, error);
  }

  } else if (text === '/subscribenewsletter' || text === 'Subscribe Newsletter') {
    try {
      await NewsletterSubscriber.findOneAndUpdate(
        { userId: chatId.toString() },
        { userId: chatId.toString(), subscribedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Subscribed to newsletter!', { parse_mode: 'HTML' });
    } catch (error) {
      bot.sendMessage(chatId, 'Error subscribing.', { parse_mode: 'HTML' });
      console.error(`[${chatId}] Subscribe newsletter error:`, error);
    }
  } else if (state.state === 'add_testimonial_name') {
    if (!isAdmin(chatId)) return;
    if (!text || text.trim().length < 2) {
      return bot.sendMessage(chatId, 'Please enter a valid name (at least 2 characters).', { parse_mode: 'HTML' });
    }
    try {
      await User.updateOne(
        { _id: chatId.toString() },
        { $set: { name: text.trim(), updatedAt: Date.now() } },
        { upsert: true }
      );
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'add_testimonial_text', data: { name: text.trim() }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter the testimonial text:', { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`[${chatId}] Add testimonial name error:`, error);
      bot.sendMessage(chatId, 'Error saving name. Please try again.', { parse_mode: 'HTML' });
    }
  } else if (state.state === 'add_testimonial_text') {
    if (!isAdmin(chatId)) return;
    if (!text || text.trim().length < 5) {
      return bot.sendMessage(chatId, 'Please enter valid testimonial text (at least 5 characters).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_testimonial_rating', data: { ...state.data, text: text.trim() }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter the rating (1-5):', { parse_mode: 'HTML' });
  } else if (state.state === 'add_testimonial_rating') {
    if (!isAdmin(chatId)) return;
    const rating = parseInt(text);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return bot.sendMessage(chatId, 'Please enter a valid rating (1-5).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_testimonial_image', data: { ...state.data, rating }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Send an image for the testimonial or type "skip" to finish:', { parse_mode: 'HTML' });
  } else if (state.state === 'add_testimonial_image') {
    if (!isAdmin(chatId)) return;
    let profileImage = null;
    if (text.toLowerCase() === 'skip') {
      console.log(`[${chatId}] User skipped testimonial image upload`);
    } else if (msg.photo) {
      console.log(`[${chatId}] Received photo: ${JSON.stringify(msg.photo)}`);
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        console.log(`[${chatId}] File link: ${fileLink}`);
        const timestamp = Math.floor(Date.now() / 1000);
        let retries = 3;
        let uploadResult = null;
        while (retries > 0) {
          try {
            uploadResult = await cloudinary.uploader.upload(fileLink, {
              folder: 'testimonials',
              timestamp: timestamp,
              resource_type: 'image',
              transformation: [{ width: 100, height: 100, crop: 'fill', quality: 'auto' }],
            });
            break;
          } catch (uploadError) {
            retries--;
            console.error(`[${chatId}] Testimonial image upload attempt failed (${retries} retries left):`, uploadError);
            if (retries === 0) throw uploadError;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        profileImage = uploadResult.secure_url;
        console.log(`[${chatId}] Testimonial image uploaded to Cloudinary: ${profileImage}`);
      } catch (error) {
        console.error(`[${chatId}] Testimonial image upload error:`, error);
        return bot.sendMessage(chatId, 'Error uploading image. Please try again or type "skip".', { parse_mode: 'HTML' });
      }
    } else {
      console.log(`[${chatId}] Invalid input: Neither photo nor 'skip'`);
      return bot.sendMessage(chatId, 'Invalid input. Please upload a photo or type "skip".', { parse_mode: 'HTML' });
    }
    try {
      const testimonial = await Testimonial.create({
        userId: chatId.toString(),
        text: state.data.text,
        profileImage,
        rating: state.data.rating,
        approved: isAdmin(chatId),
        createdAt: Date.now(),
      });
      console.log(`[${chatId}] Testimonial created: ${testimonial._id}`);
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'idle', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, `Testimonial added by ${escapeHtml(state.data.name)}!`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back', callback_data: 'menu_testimonials' }]],
        },
      });
    } catch (error) {
      console.error(`[${chatId}] Add testimonial error:`, error);
      bot.sendMessage(chatId, 'Error submitting testimonial.', { parse_mode: 'HTML' });
    }
  } else if (state.state === 'add_product_name') {
    if (!isAdmin(chatId)) return;
    if (!text || text.trim().length < 2) {
      return bot.sendMessage(chatId, 'Please enter a valid product name (at least 2 characters).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_product_price', data: { name: text.trim() }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter product price (e.g., 5000 or 700k for 700,000):', { parse_mode: 'HTML' });
  } else if (state.state === 'add_product_price') {
    if (!isAdmin(chatId)) return;
    let price = text.toLowerCase().replace(/\s/g, '');
    let multiplier = 1;
    if (price.endsWith('k')) {
      multiplier = 1000;
      price = price.slice(0, -1);
    } else if (price.endsWith('m')) {
      multiplier = 1000000;
      price = price.slice(0, -1);
    }
    const parsedPrice = parseFloat(price) * multiplier;
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return bot.sendMessage(chatId, 'Invalid price. Enter a number (e.g., 5000 or 700k).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_product_description', data: { ...state.data, price: parsedPrice }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Enter product description:', { parse_mode: 'HTML' });
  } else if (state.state === 'add_product_description') {
    if (!isAdmin(chatId)) return;
    if (!text || text.trim().length < 5) {
      return bot.sendMessage(chatId, 'Please enter a valid description (at least 5 characters).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_product_image', data: { ...state.data, description: text.trim(), images: [] }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, `Please upload the first product image (photo) or type "skip" to proceed without images. You can add up to ${MAX_PRODUCT_IMAGES} images.`, { parse_mode: 'HTML' });
  } else if (state.state === 'add_product_image') {
    if (!isAdmin(chatId)) return;
    let imageUrl = null;
    if (text.toLowerCase() === 'skip') {
      console.log(`[${chatId}] User skipped first product image`);
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'add_product_isBestseller', data: { ...state.data, images: [] }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Is it a bestseller? (yes/no):', { parse_mode: 'HTML' });
    } else if (msg.photo) {
      console.log(`[${chatId}] Received photo: ${JSON.stringify(msg.photo)}`);
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        console.log(`[${chatId}] File link: ${fileLink}`);
        const timestamp = Math.floor(Date.now() / 1000);
        let retries = 3;
        let uploadResult = null;
        while (retries > 0) {
          try {
            uploadResult = await cloudinary.uploader.upload(fileLink, {
              folder: 'products',
              timestamp: timestamp,
              resource_type: 'image',
              transformation: [{ width: 300, height: 300, crop: 'fill', quality: 'auto' }],
            });
            break;
          } catch (uploadError) {
            retries--;
            console.error(`[${chatId}] Product image upload attempt failed (${retries} retries left):`, uploadError);
            if (retries === 0) throw uploadError;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        imageUrl = uploadResult.secure_url;
        console.log(`[${chatId}] Product image uploaded to Cloudinary: ${imageUrl}`);
        await BotState.updateOne(
          { chatId: chatId.toString() },
          { state: 'add_product_image_more', data: { ...state.data, images: [imageUrl] }, updatedAt: Date.now() },
          { upsert: true }
        );
        bot.sendMessage(chatId, `Image uploaded. Add another image? (1/${MAX_PRODUCT_IMAGES})\nUpload a photo, type "done" to finish, or "skip" to proceed without more images.`, { parse_mode: 'HTML' });
      } catch (error) {
        console.error(`[${chatId}] Product image upload error:`, error);
        return bot.sendMessage(chatId, 'Error uploading image. Please try again or type "skip" to proceed without images.', { parse_mode: 'HTML' });
      }
    } else {
      console.log(`[${chatId}] Invalid input: Neither photo nor 'skip'`);
      return bot.sendMessage(chatId, 'Invalid input. Please upload a photo or type "skip" to proceed without images.', { parse_mode: 'HTML' });
    }
  } else if (state.state === 'add_product_image_more') {
    if (!isAdmin(chatId)) return;
    if (text.toLowerCase() === 'done' || text.toLowerCase() === 'skip' || state.data.images.length >= MAX_PRODUCT_IMAGES) {
      console.log(`[${chatId}] Finished adding images: ${state.data.images.length}`);
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'add_product_isBestseller', data: state.data, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Is it a bestseller? (yes/no):', { parse_mode: 'HTML' });
    } else if (msg.photo) {
      console.log(`[${chatId}] Received photo: ${JSON.stringify(msg.photo)}`);
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        console.log(`[${chatId}] File link: ${fileLink}`);
        const timestamp = Math.floor(Date.now() / 1000);
        let retries = 3;
        let uploadResult = null;
        while (retries > 0) {
          try {
            uploadResult = await cloudinary.uploader.upload(fileLink, {
              folder: 'products',
              timestamp: timestamp,
              resource_type: 'image',
              transformation: [{ width: 300, height: 300, crop: 'fill', quality: 'auto' }],
            });
            break;
          } catch (uploadError) {
            retries--;
            console.error(`[${chatId}] Product image upload attempt failed (${retries} retries left):`, uploadError);
            if (retries === 0) throw uploadError;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        const imageUrl = uploadResult.secure_url;
        console.log(`[${chatId}] Product image uploaded to Cloudinary: ${imageUrl}`);
        state.data.images.push(imageUrl);
        await BotState.updateOne(
          { chatId: chatId.toString() },
          { state: 'add_product_image_more', data: state.data, updatedAt: Date.now() },
          { upsert: true }
        );
        if (state.data.images.length < MAX_PRODUCT_IMAGES) {
          bot.sendMessage(chatId, `Image uploaded. Add another image? (${state.data.images.length}/${MAX_PRODUCT_IMAGES})\nUpload a photo, type "done" to finish, or "skip" to proceed without more images.`, { parse_mode: 'HTML' });
        } else {
          await BotState.updateOne(
            { chatId: chatId.toString() },
            { state: 'add_product_isBestseller', data: state.data, updatedAt: Date.now() },
            { upsert: true }
          );
          bot.sendMessage(chatId, 'Is it a bestseller? (yes/no):', { parse_mode: 'HTML' });
        }
      } catch (error) {
        console.error(`[${chatId}] Product image upload error:`, error);
        bot.sendMessage(chatId, `Error uploading image. Please try again, type "done" to finish, or "skip" to proceed without more images. (${state.data.images.length}/${MAX_PRODUCT_IMAGES})`, { parse_mode: 'HTML' });
      }
    } else {
      console.log(`[${chatId}] Invalid input: Neither photo nor 'done'/'skip'`);
      bot.sendMessage(chatId, `Invalid input. Please upload a photo, type "done" to finish, or "skip" to proceed without more images. (${state.data.images.length}/${MAX_PRODUCT_IMAGES})`, { parse_mode: 'HTML' });
    }
  } else if (state.state === 'add_product_isBestseller') {
    if (!isAdmin(chatId)) return;
    const isBestseller = text.toLowerCase() === 'yes';
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_product_confirm', data: { ...state.data, isBestseller }, updatedAt: Date.now() },
      { upsert: true }
    );
    const categories = await Category.find();
    const categoryMessage = categories.length ? 'Select a category below or skip.' : 'No categories available. You can skip.';
    const imageList = state.data.images.length
      ? state.data.images.map((img, i) => `Image ${i + 1}: ${escapeHtml(img)}`).join('\n')
      : 'No images';
    console.log(`[${chatId}] Generating category buttons:`, categories.map(c => ({ name: c.name, id: c._id.toString() })));
    bot.sendMessage(chatId, `Confirm product details:\nName: ${escapeHtml(state.data.name)}\nPrice: ₦${state.data.price.toFixed(2)}\nDescription: ${escapeHtml(state.data.description)}\nImages:\n${imageList}\nBestseller: ${isBestseller ? 'Yes' : 'No'}\n\n${categoryMessage}`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...categories.map(category => [{ text: escapeHtml(category.name), callback_data: `select_category:${category._id}` }]),
          [{ text: 'Skip Category', callback_data: 'select_category:none' }],
          [{ text: 'Confirm', callback_data: 'confirm_product' }],
          [{ text: 'Cancel', callback_data: 'cancel_product' }],
        ],
      },
    });
  } else if (state.state === 'add_category_name') {
    if (!isAdmin(chatId)) return;
    if (!text || text.trim().length < 2) {
      return bot.sendMessage(chatId, 'Please enter a valid category name (at least 2 characters).', { parse_mode: 'HTML' });
    }
    await BotState.updateOne(
      { chatId: chatId.toString() },
      { state: 'add_category_image', data: { name: text.trim() }, updatedAt: Date.now() },
      { upsert: true }
    );
    bot.sendMessage(chatId, 'Please upload a category image (photo) or type "skip" to proceed without an image.', { parse_mode: 'HTML' });
  } else if (state.state === 'add_category_image') {
    if (!isAdmin(chatId)) return;
    let imageUrl = null;
    if (text.toLowerCase() === 'skip') {
      console.log(`[${chatId}] User skipped category image upload`);
    } else if (msg.photo) {
      console.log(`[${chatId}] Received photo groom: ${JSON.stringify(msg.photo)}`);
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        console.log(`[${chatId}] File link: ${fileLink}`);
        const timestamp = Math.floor(Date.now() / 1000);
        let retries = 3;
        let uploadResult = null;
        while (retries > 0) {
          try {
            uploadResult = await cloudinary.uploader.upload(fileLink, {
              folder: 'categories',
              timestamp: timestamp,
              resource_type: 'image',
              transformation: [{ width: 200, height: 200, crop: 'fill', quality: 'auto' }],
            });
            break;
          } catch (uploadError) {
            retries--;
            console.error(`[${chatId}] Category image upload attempt failed (${retries} retries left):`, uploadError);
            if (retries === 0) throw uploadError;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        imageUrl = uploadResult.secure_url;
        console.log(`[${chatId}] Category image uploaded to Cloudinary: ${imageUrl}`);
      } catch (error) {
        console.error(`[${chatId}] Category image upload error:`, error);
        return bot.sendMessage(chatId, 'Error uploading image. Please try again or type "skip" to proceed without an image.', { parse_mode: 'HTML' });
      }
    } else {
      console.log(`[${chatId}] Invalid input: Neither photo nor 'skip'`);
      return bot.sendMessage(chatId, 'Invalid input. Please upload a photo or type "skip" to proceed without an image.', { parse_mode: 'HTML' });
    }
    try {
      const category = await Category.create({
        name: state.data.name,
        image: imageUrl,
      });
      console.log(`[${chatId}] Category created: ${category._id}`);
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'idle', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, `Category added: ${escapeHtml(category.name)}`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back', callback_data: 'menu_categories' }]],
        },
      });
    } catch (error) {
      console.error(`[${chatId}] Add category error:`, error);
      bot.sendMessage(chatId, 'Error adding category.', { parse_mode: 'HTML' });
    }
  } else {
    bot.sendMessage(chatId, 'Unknown command or state. Use /start to begin.', {
      parse_mode: 'HTML',
      ...getAdminKeyboard(),
    });
  }
});
  
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (!isAdmin(chatId)) {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, 'Unauthorized.', { parse_mode: 'HTML' });
  }
  const [action, ...params] = query.data.split(':');
  const callbackData = query.data;
  await bot.answerCallbackQuery(query.id);
  try {
    const state = await BotState.findOne({ chatId: chatId.toString() });
    console.log(`[${chatId}] Callback query: ${callbackData}, State: ${state?.state || 'none'}`);

    if (action === 'menu_products') {
      bot.sendMessage(chatId, '<b>Product Management</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add Product', callback_data: 'add_product' },
              { text: '📦 Manage Products', callback_data: 'manage_products:1' },
            ],
            [{ text: '🔙 Back', callback_data: 'main_menu' }],
          ],
        },
      });
    } else if (action === 'menu_categories') {
      bot.sendMessage(chatId, '<b>Category Management</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add Category', callback_data: 'add_category' },
              { text: '📋 Manage Categories', callback_data: 'manage_categories:1' },
            ],
            [{ text: '🔙 Back', callback_data: 'main_menu' }],
          ],
        },
      });
    } else if (action === 'menu_orders') {
      bot.sendMessage(chatId, '<b>Orders & Subscribers</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🛒 View Orders', callback_data: 'view_orders:1' },
              { text: '👥 View Subscribers', callback_data: 'view_subscribers:1' },
            ],
            [{ text: '🔙 Back', callback_data: 'main_menu' }],
          ],
        },
      });
    } else if (action === 'menu_testimonials') {
      bot.sendMessage(chatId, '<b>Testimonial Management</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add Testimonial', callback_data: 'add_testimonial' },
              { text: '👀 View Testimonials', callback_data: 'view_testimonials:1' },
            ],
            [
              { text: '⚙️ Manage Testimonials', callback_data: 'manage_testimonials:1' },
              { text: '🔙 Back', callback_data: 'main_menu' },
            ],
          ],
        },
      });
    } else if (action === 'main_menu') {
      bot.sendMessage(chatId, 'Main Menu', {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    } else if (action === 'add_testimonial') {
      try {
        // Ensure admin user exists
        await User.updateOne(
          { _id: chatId.toString() },
          { $setOnInsert: { name: 'Admin', updatedAt: Date.now() } },
          { upsert: true }
        );
        // Always prompt for the testimonial author's name
        await BotState.updateOne(
          { chatId: chatId.toString() },
          { state: 'add_testimonial_name', data: {}, updatedAt: Date.now() },
          { upsert: true }
        );
        bot.sendMessage(chatId, 'Enter the name for the testimonial author:', { parse_mode: 'HTML' });
      } catch (error) {
        console.error(`[${chatId}] Add testimonial error:`, error);
        bot.sendMessage(chatId, 'Error starting testimonial creation. Please try again.', { parse_mode: 'HTML' });
      }
    } else if (action === 'add_product') {
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'add_product_name', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter product name:', { parse_mode: 'HTML' });
    } else if (action === 'add_category') {
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'add_category_name', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter category name:', { parse_mode: 'HTML' });
    } else if (action === 'view_orders') {
      const [page = 1] = params;
      const ITEMS_PER_PAGE = 5;
      try {
        const total = await Order.countDocuments();
        const orders = await Order.find()
          .populate('products.productId')
          .populate({ path: 'userId', select: 'name email phone', model: 'User' })
          .sort({ createdAt: -1 })
          .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
          .limit(ITEMS_PER_PAGE);
        if (!orders.length) {
          return bot.sendMessage(chatId, 'No orders found.', { parse_mode: 'HTML' });
        }
        let message = `<b>Orders (Page ${page}):</b>\n`;
        orders.forEach(order => {
          console.log(`[${chatId}] Order: ${order._id}, Created: ${order.createdAt}`);
          const total = typeof order.total === 'number' ? order.total.toFixed(2) : 'N/A';
          const userInfo = order.userId
            ? `${escapeHtml(order.userId.name || 'Anonymous')} (${escapeHtml(order.userId.email || 'No email')}${order.userId.phone ? `, ${escapeHtml(order.userId.phone)}` : ''})`
            : 'Unknown User';
          message += `<b>Order ID:</b> ${order._id}\n<b>User:</b> ${userInfo}\n<b>Total:</b> ₦${total}\n<b>Status:</b> ${escapeHtml(order.status)}\n<b>Products:</b>\n`;
          order.products.forEach(p => {
            const productName = p.productId ? escapeHtml(p.productId.name) : 'Unknown Product';
            message += `- ${productName} (Qty: ${p.quantity})\n`;
          });
          message += `<b>Created:</b> ${order.createdAt.toLocaleDateString()}\n\n`;
        });
        console.log(`[${chatId}] Message length: ${message.length}`);
        const buttons = [];
        if (parseInt(page) > 1) {
          buttons.push([{ text: '⬅️ Previous', callback_data: `view_orders:${parseInt(page) - 1}` }]);
        }
        if (parseInt(page) * ITEMS_PER_PAGE < total) {
          buttons.push([{ text: '➡️ Next', callback_data: `view_orders:${parseInt(page) + 1}` }]);
        }
        buttons.push([{ text: '🔙 Back', callback_data: 'menu_orders' }]);
        bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        bot.sendMessage(chatId, 'Error fetching orders.', { parse_mode: 'HTML' });
        console.error(`[${chatId}] View orders error:`, error);
      }
    } else if (action === 'view_subscribers') {
      const [page = 1] = params;
      const ITEMS_PER_PAGE = 5;
      try {
        const total = await NewsletterSubscriber.countDocuments();
        const subscribers = await NewsletterSubscriber.find()
          .populate({ path: 'userId', select: 'name email phone', model: 'User' })
          .sort({ subscribedAt: -1 })
          .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
          .limit(ITEMS_PER_PAGE);
        if (!subscribers.length) {
          return bot.sendMessage(chatId, 'No subscribers found.', { parse_mode: 'HTML' });
        }
        let message = `<b>Newsletter Subscribers (Page ${page}):</b>\n`;
        subscribers.forEach(s => {
          const userInfo = s.userId
            ? `${escapeHtml(s.userId.name || 'Anonymous')} (${escapeHtml(s.userId.email || 'No email')}${s.userId.phone ? `, ${escapeHtml(s.userId.phone)}` : ''})`
            : 'Unknown User';
          message += `<b>User:</b> ${userInfo}\n<b>Subscribed:</b> ${s.subscribedAt.toLocaleDateString()}\n\n`;
        });
        console.log(`[${chatId}] Message length: ${message.length}`);
        const buttons = [];
        if (parseInt(page) > 1) {
          buttons.push([{ text: '⬅️ Previous', callback_data: `view_subscribers:${parseInt(page) - 1}` }]);
        }
        if (parseInt(page) * ITEMS_PER_PAGE < total) {
          buttons.push([{ text: '➡️ Next', callback_data: `view_subscribers:${parseInt(page) + 1}` }]);
        }
        buttons.push([{ text: '🔙 Back', callback_data: 'menu_orders' }]);
        bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        bot.sendMessage(chatId, 'Error fetching subscribers.', { parse_mode: 'HTML' });
        console.error(`[${chatId}] View subscribers error:`, error);
      }
    } else if (action === 'view_testimonials') {
      const [page = 1] = params;
      const ITEMS_PER_PAGE = 5;
      try {
        const total = await Testimonial.countDocuments({ approved: true });
        const testimonials = await Testimonial.find({ approved: true })
          .populate({ path: 'userId', select: 'name', model: 'User' })
          .sort({ createdAt: -1 })
          .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
          .limit(ITEMS_PER_PAGE);
        if (!testimonials.length) {
          return bot.sendMessage(chatId, 'No approved testimonials found.', { parse_mode: 'HTML' });
        }
        let message = `<b>Testimonials (Page ${page}):</b>\n`;
        testimonials.forEach(t => {
          console.log(`[${chatId}] Testimonial:`, { userId: t.userId?._id, name: t.userId?.name, rating: t.rating, text: t.text, image: t.profileImage });
          const name = t.userId ? escapeHtml(t.userId.name || 'Anonymous') : 'Anonymous';
          const stars = '⭐'.repeat(t.rating);
          message += `<b>Name:</b> ${name}\n<b>Rating:</b> ${stars}\n<b>Text:</b> ${escapeHtml(t.text.substring(0, 200))}...\n${t.profileImage ? `<b>Image:</b> ${escapeHtml(t.profileImage)}\n` : ''}<b>Date:</b> ${t.createdAt.toLocaleDateString()}\n\n`;
        });
        console.log(`[${chatId}] Message length: ${message.length}`);
        const buttons = [];
        if (parseInt(page) > 1) {
          buttons.push([{ text: '⬅️ Previous', callback_data: `view_testimonials:${parseInt(page) - 1}` }]);
        }
        if (parseInt(page) * ITEMS_PER_PAGE < total) {
          buttons.push([{ text: '➡️ Next', callback_data: `view_testimonials:${parseInt(page) + 1}` }]);
        }
        buttons.push([{ text: '🔙 Back', callback_data: 'menu_testimonials' }]);
        bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        bot.sendMessage(chatId, 'Error fetching testimonials.', { parse_mode: 'HTML' });
        console.error(`[${chatId}] View testimonials error:`, error);
      }
    } else if (action === 'select_category') {
      const [categoryId] = params;
      if (!state || state.state !== 'add_product_confirm') {
        console.log(`[${chatId}] Invalid state for select_category: ${state?.state || 'none'}`);
        return bot.sendMessage(chatId, 'Invalid state. Please start over with /start.', { parse_mode: 'HTML' });
      }
      if (categoryId !== 'none' && !mongoose.Types.ObjectId.isValid(categoryId)) {
        console.error(`[${chatId}] Invalid categoryId: ${categoryId}`);
        return bot.sendMessage(chatId, 'Invalid category selected. Please try again.', { parse_mode: 'HTML' });
      }
      state.data.categoryId = categoryId !== 'none' ? categoryId : null;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: state.state, data: state.data, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Category selected. Please confirm or cancel.', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Confirm', callback_data: 'confirm_product' }],
            [{ text: 'Cancel', callback_data: 'cancel_product' }],
          ],
        },
      });
    } else if (action === 'confirm_product') {
      if (!state || state.state !== 'add_product_confirm') {
        console.log(`[${chatId}] Invalid state for confirm_product: ${state?.state || 'none'}`);
        return bot.sendMessage(chatId, 'Invalid state. Please start over with /start.', { parse_mode: 'HTML' });
      }
      if (state.data.categoryId && !mongoose.Types.ObjectId.isValid(state.data.categoryId)) {
        console.error(`[${chatId}] Invalid categoryId in confirm_product: ${state.data.categoryId}`);
        return bot.sendMessage(chatId, 'Invalid category ID. Please select a category again or skip.', { parse_mode: 'HTML' });
      }
      console.log(`[${chatId}] Creating product with data:`, {
        name: state.data.name,
        price: state.data.price,
        description: state.data.description,
        images: state.data.images,
        isBestseller: state.data.isBestseller,
        categoryId: state.data.categoryId,
      });
      const product = await Product.create({
        name: state.data.name,
        price: state.data.price,
        description: state.data.description,
        images: state.data.images,
        isBestseller: state.data.isBestseller,
        categoryId: state.data.categoryId || null,
      });
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'idle', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, `Product added: ${formatProduct(product)}`, {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    } else if (action === 'cancel_product') {
      if (!state || state.state !== 'add_product_confirm') {
        console.log(`[${chatId}] Invalid state for cancel_product: ${state?.state || 'none'}`);
        return bot.sendMessage(chatId, 'Invalid state. Please start over with /start.', { parse_mode: 'HTML' });
      }
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'idle', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Product addition cancelled.', {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    } else if (action === 'manage_product') {
      const [productId, page] = params;
      const product = await Product.findById(productId).populate('categoryId');
      if (!product) {
        return bot.sendMessage(chatId, 'Product not found.', { parse_mode: 'HTML' });
      }
      const buttons = [
        [{ text: 'Edit', callback_data: `edit_product_name:${productId}` }],
        [{ text: 'Delete', callback_data: `delete_product:${productId}` }],
        [{ text: '🔙 Back', callback_data: `manage_products:${page || 1}` }],
      ];
      bot.sendMessage(chatId, formatProduct(product), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } else if (action === 'manage_products') {
      const [page = 1] = params;
      const ITEMS_PER_PAGE = 8;
      try {
        const total = await Product.countDocuments();
        const products = await Product.find()
          .populate('categoryId')
          .sort({ createdAt: -1 })
          .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
          .limit(ITEMS_PER_PAGE);
        if (!products.length) {
          return bot.sendMessage(chatId, 'No more products.', { parse_mode: 'HTML' });
        }
        const buttons = [];
        for (let i = 0; i < products.length; i += 2) {
          const row = [
            { text: `📦 ${escapeHtml(products[i].name.substring(0, 20))}...`, callback_data: `manage_product:${products[i]._id}:${page}` },
          ];
          if (i + 1 < products.length) {
            row.push({ text: `📦 ${escapeHtml(products[i + 1].name.substring(0, 20))}...`, callback_data: `manage_product:${products[i + 1]._id}:${page}` });
          }
          buttons.push(row);
        }
        if (parseInt(page) > 1) {
          buttons.push([{ text: '⬅️ Previous', callback_data: `manage_products:${parseInt(page) - 1}` }]);
        }
        if (parseInt(page) * ITEMS_PER_PAGE < total) {
          buttons.push([{ text: '➡️ Next', callback_data: `manage_products:${parseInt(page) + 1}` }]);
        }
        buttons.push([{ text: '🔙 Back', callback_data: 'menu_products' }]);
        bot.sendMessage(chatId, '<b>Manage Products</b>', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        bot.sendMessage(chatId, 'Error fetching products.', { parse_mode: 'HTML' });
        console.error(`[${chatId}] Manage products error:`, error);
      }
    } else if (action === 'edit_product_name') {
      const [productId] = params;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'edit_product_name', data: { productId }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter new product name:', { parse_mode: 'HTML' });
    } else if (action === 'edit_product_price') {
      const [productId] = params;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'edit_product_price', data: { productId }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter new product price (₦):', { parse_mode: 'HTML' });
    } else if (action === 'edit_product_description') {
      const [productId] = params;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'edit_product_description', data: { productId }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter new product description:', { parse_mode: 'HTML' });
    } else if (action === 'edit_product_category') {
      const [productId] = params;
      const categories = await Category.find();
      const buttons = categories.map(category => ({
        text: escapeHtml(category.name),
        callback_data: `update_category:${category._id}:${productId}`,
      }));
      buttons.push({ text: 'None', callback_data: `update_category:none:${productId}` });
      const keyboard = [];
      for (let i = 0; i < buttons.length; i += 2) {
        const row = [buttons[i]];
        if (i + 1 < buttons.length) row.push(buttons[i + 1]);
        keyboard.push(row);
      }
      keyboard.push([{ text: '🔙 Back', callback_data: `manage_product:${productId}` }]);
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'edit_product_category', data: { productId }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Select new category:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else if (action === 'delete_product') {
      const [productId] = params;
      const product = await Product.findByIdAndDelete(productId);
      if (!product) {
        return bot.sendMessage(chatId, 'Product not found.', { parse_mode: 'HTML' });
      }
      bot.sendMessage(chatId, `Product deleted: ${escapeHtml(product.name)}`, {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    } else if (action === 'update_category') {
      const [categoryId, productId] = params;
      if (!state || !['add_product_confirm', 'edit_product_category'].includes(state.state)) {
        console.log(`[${chatId}] Invalid state for update_category: ${state?.state || 'none'}`);
        return bot.sendMessage(chatId, 'Invalid state. Please start over with /start.', { parse_mode: 'HTML' });
      }
      if (categoryId !== 'none' && !mongoose.Types.ObjectId.isValid(categoryId)) {
        console.error(`[${chatId}] Invalid categoryId in update_category: ${categoryId}`);
        return bot.sendMessage(chatId, 'Invalid category ID. Please select a category again.', { parse_mode: 'HTML' });
      }
      state.data.categoryId = categoryId !== 'none' ? categoryId : null;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: state.state, data: state.data, updatedAt: Date.now() },
        { upsert: true }
      );
      const actionText = state.state === 'add_product_confirm' ? 'Category selected. Please confirm or cancel.' : 'Category updated. Please confirm or cancel.';
      bot.sendMessage(chatId, actionText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Confirm', callback_data: state.state === 'add_product_confirm' ? 'confirm_product' : `confirm_edit_product:${productId}` }],
            [{ text: 'Cancel', callback_data: state.state === 'add_product_confirm' ? 'cancel_product' : `manage_product:${productId}` }],
          ],
        },
      });
    } else if (action === 'confirm_edit_product') {
      const [productId] = params;
      if (!state || state.state !== 'edit_product_category') {
        console.log(`[${chatId}] Invalid state for confirm_edit_product: ${state?.state || 'none'}`);
        return bot.sendMessage(chatId, 'Invalid state. Please start over with /start.', { parse_mode: 'HTML' });
      }
      console.log(`[${chatId}] Updating product with data:`, {
        productId: state.data.productId,
        name: state.data.name,
        price: state.data.price,
        description: state.data.description,
        categoryId: state.data.categoryId,
      });
      const product = await Product.findByIdAndUpdate(
        state.data.productId,
        {
          name: state.data.name,
          price: parseFloat(state.data.price),
          description: state.data.description,
          categoryId: state.data.categoryId || null,
        },
        { new: true }
      ).populate('categoryId');
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'idle', data: {}, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, `Product updated: ${formatProduct(product)}`, {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    } else if (action === 'manage_category') {
      const [categoryId, page] = params;
      const category = await Category.findById(categoryId);
      if (!category) {
        return bot.sendMessage(chatId, 'Category not found.', { parse_mode: 'HTML' });
      }
      const buttons = [
        [{ text: 'Edit', callback_data: `edit_category_name:${categoryId}` }],
        [{ text: 'Delete', callback_data: `delete_category:${categoryId}` }],
        [{ text: '🔙 Back', callback_data: `manage_categories:${page || 1}` }],
      ];
      bot.sendMessage(chatId, formatCategory(category), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } else if (action === 'manage_categories') {
      const [page = 1] = params;
      const ITEMS_PER_PAGE = 8;
      try {
        const total = await Category.countDocuments();
        const categories = await Category.find()
          .sort({ createdAt: -1 })
          .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
          .limit(ITEMS_PER_PAGE);
        if (!categories.length) {
          return bot.sendMessage(chatId, 'No more categories.', { parse_mode: 'HTML' });
        }
        const buttons = [];
        for (let i = 0; i < categories.length; i += 2) {
          const row = [
            { text: `📋 ${escapeHtml(categories[i].name.substring(0, 20))}...`, callback_data: `manage_category:${categories[i]._id}:${page}` },
          ];
          if (i + 1 < categories.length) {
            row.push({ text: `📋 ${escapeHtml(categories[i + 1].name.substring(0, 20))}...`, callback_data: `manage_category:${categories[i + 1]._id}:${page}` });
          }
          buttons.push(row);
        }
        if (parseInt(page) > 1) {
          buttons.push([{ text: '⬅️ Previous', callback_data: `manage_categories:${parseInt(page) - 1}` }]);
        }
        if (parseInt(page) * ITEMS_PER_PAGE < total) {
          buttons.push([{ text: '➡️ Next', callback_data: `manage_categories:${parseInt(page) + 1}` }]);
        }
        buttons.push([{ text: '🔙 Back', callback_data: 'menu_categories' }]);
        bot.sendMessage(chatId, '<b>Manage Categories</b>', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        bot.sendMessage(chatId, 'Error fetching categories.', { parse_mode: 'HTML' });
        console.error(`[${chatId}] Manage categories error:`, error);
      }
    } else if (action === 'edit_category_name') {
      const [categoryId] = params;
      await BotState.updateOne(
        { chatId: chatId.toString() },
        { state: 'edit_category_name', data: { categoryId }, updatedAt: Date.now() },
        { upsert: true }
      );
      bot.sendMessage(chatId, 'Enter new category name:', { parse_mode: 'HTML' });
    } else if (action === 'delete_category') {
      const [categoryId] = params;
      const category = await Category.findByIdAndDelete(categoryId);
      if (!category) {
        return bot.sendMessage(chatId, 'Category not found.', { parse_mode: 'HTML' });
      }
      await Product.updateMany({ categoryId }, { $unset: { categoryId: '' } });
      bot.sendMessage(chatId, `Category deleted: ${escapeHtml(category.name)}`, {
        parse_mode: 'HTML',
        ...getAdminKeyboard(),
      });
    
  } else if (action === 'manage_testimonial') {
  const [testimonialId, page] = params;
  try {
    const testimonial = await Testimonial.findById(testimonialId);
    if (!testimonial) {
      bot.answerCallbackQuery(query.id, { text: 'Testimonial not found.' });
      return bot.editMessageText('Testimonial not found.', {
        chat_id: chatId,
        message_id: query.message.message_id, // Use query.message.message_id directly
        parse_mode: 'HTML',
      });
    }
    const name = escapeHtml(testimonial.name || 'Anonymous');
    const stars = '⭐'.repeat(Number(testimonial.rating) || 5);
    const message = `<b>Testimonial Details:</b>\n<b>Name:</b> ${name}\n<b>Rating:</b> ${stars}\n<b>Text:</b> ${escapeHtml(testimonial.text.substring(0, 200))}...\n${testimonial.profileImage ? `<b>Image:</b> ${escapeHtml(testimonial.profileImage)}\n` : ''}<b>Status:</b> ${testimonial.approved ? 'Approved ✅' : 'Pending ⏳'}\n<b>Date:</b> ${testimonial.createdAt.toLocaleDateString()}`;
    console.log(`[${chatId}] Message length: ${message.length}`);
    const buttons = [
      [{ text: testimonial.approved ? 'Unapprove' : 'Approve', callback_data: `approve_testimonial:${testimonialId}:${page}` }],
      [{ text: 'Delete', callback_data: `delete_testimonial:${testimonialId}:${page}` }],
      [{ text: '🔙 Back', callback_data: `manage_testimonials:${page}` }],
    ];
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: query.message.message_id, // Use query.message.message_id directly
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error fetching testimonial.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Manage testimonial error:`, error);
  }
} else if (action === 'manage_testimonials') {
  const [page = 1] = params;
  const ITEMS_PER_PAGE = 8;
  try {
    const total = await Testimonial.countDocuments();
    const testimonials = await Testimonial.find()
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);
    if (!testimonials.length) {
      return bot.sendMessage(chatId, 'No more testimonials.', {
        parse_mode: 'HTML',
      });
    }
    const buttons = [];
    for (let i = 0; i < testimonials.length; i += 2) {
      const row = [
        {
          text: `${escapeHtml(testimonials[i].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i].rating) || 5} ${testimonials[i].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i]._id}:${page}`,
        },
      ];
      if (i + 1 < testimonials.length) {
        row.push({
          text: `${escapeHtml(testimonials[i + 1].name || 'Anonymous').substring(0, 10)} - ⭐${Number(testimonials[i + 1].rating) || 5} ${testimonials[i + 1].approved ? '✅' : '⏳'}`,
          callback_data: `manage_testimonial:${testimonials[i + 1]._id}:${page}`,
        });
      }
      buttons.push(row);
    }
    if (parseInt(page) > 1) {
      buttons.push([{ text: '⬅️ Previous', callback_data: `manage_testimonials:${parseInt(page) - 1}` }]);
    }
    if (parseInt(page) * ITEMS_PER_PAGE < total) {
      buttons.push([{ text: '➡️ Next', callback_data: `manage_testimonials:${parseInt(page) + 1}` }]);
    }
    buttons.push([{ text: '🔙 Back', callback_data: 'menu_testimonials' }]);
    bot.sendMessage(chatId, `<b>Manage Testimonials (Page ${page})</b>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error fetching testimonials.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Manage testimonials error:`, error);
  }
} else if (action === 'approve_testimonial') {
  const [testimonialId, page] = params;
  try {
    const testimonial = await Testimonial.findById(testimonialId);
    if (!testimonial) {
      bot.answerCallbackQuery(query.id, { text: 'Testimonial not found.' });
      return bot.editMessageText('Testimonial not found.', {
        chat_id: chatId,
        message_id: query.message.message_id, // Use query.message.message_id directly
        parse_mode: 'HTML',
      });
    }
    testimonial.approved = !testimonial.approved;
    await testimonial.save();
    const name = escapeHtml(testimonial.name || 'Anonymous');
    bot.editMessageText(`Testimonial by ${name} ${testimonial.approved ? 'approved' : 'unapproved'}.`, {
      chat_id: chatId,
      message_id: query.message.message_id, // Use query.message.message_id directly
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: `manage_testimonials:${page}` }]],
      },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error updating testimonial.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Approve testimonial error:`, error);
  }
} else if (action === 'delete_testimonial') {
  const [testimonialId, page] = params;
  try {
    const testimonial = await Testimonial.findByIdAndDelete(testimonialId);
    if (!testimonial) {
      bot.answerCallbackQuery(query.id, { text: 'Testimonial not found.' });
      return bot.editMessageText('Testimonial not found.', {
        chat_id: chatId,
        message_id: query.message.message_id, // Use query.message.message_id directly
        parse_mode: 'HTML',
      });
    }
    const name = escapeHtml(testimonial.name || 'Anonymous');
    bot.editMessageText(`Testimonial by ${name} deleted.`, {
      chat_id: chatId,
      message_id: query.message.message_id, // Use query.message.message_id directly
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: `manage_testimonials:${page}` }]],
      },
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Error deleting testimonial.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Delete testimonial error:`, error);
  }
}
  } catch (error) {
    bot.sendMessage(chatId, 'An error occurred. Please try again.', { parse_mode: 'HTML' });
    console.error(`[${chatId}] Callback query error:`, error);
  }
});


app.get('/api/products', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, category, priceMin, priceMax, sortBy, sortOrder } = req.query;
    const query = {};
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      query.categoryId = category;
    }
    if (priceMin || priceMax) {
      query.price = {};
      if (priceMin) query.price.$gte = parseFloat(priceMin);
      if (priceMax) query.price.$lte = parseFloat(priceMax);
    }
    const sort = {};
    if (sortBy) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sort.createdAt = -1;
    }
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('categoryId')
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(query),
    ]);
    res.json({ products, total });
  } catch (error) {
    console.error(`[${req.id}] Fetch products error:`, error);
    next(error);
  }
});
// ... other routes ...
app.get('/api/products/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('categoryId');
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', checkApiKey, async (req, res, next) => {
  try {
    const { name, price, description, images, isBestseller, categoryId } = req.body;
    if (!name || !price || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Validate categoryId if provided
    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }
    const product = await Product.create({
      name,
      price: parseFloat(price),
      description,
      images: Array.isArray(images) ? images.slice(0, MAX_PRODUCT_IMAGES) : [],
      isBestseller: !!isBestseller,
      categoryId: categoryId || null,
    });
    await product.populate('categoryId');
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

app.put('/api/products/:id', checkApiKey, async (req, res, next) => {
  try {
    const { name, price, description, images, isBestseller, categoryId } = req.body;
    // Validate categoryId if provided
    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name,
        price: parseFloat(price),
        description,
        images: Array.isArray(images) ? images.slice(0, MAX_PRODUCT_IMAGES) : [],
        isBestseller: !!isBestseller,
        categoryId: categoryId || null,
      },
      { new: true, runValidators: true }
    ).populate('categoryId');
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/products/:id', checkApiKey, async (req, res, next) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json({ message: `Product deleted: ${product.name}` });
    } catch (error) {
      next(error);
    }
});

app.get('/api/categories', async (req, res, next) => {
  try {
    const { limit } = req.query;
    const limitNum = parseInt(limit) || 0; // 0 means no limit
    const query = Category.find();
    if (limitNum > 0) {
      query.limit(limitNum);
    }
    const categories = await query.exec();
    // Calculate productCount for each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({ categoryId: category._id });
        return { ...category._doc, productCount };
      })
    );
    res.json(categoriesWithCount);
  } catch (error) {
    console.error(`[${req.id}] Fetch categories error:`, error);
    next(error);
  }
});

app.post('/api/categories', checkApiKey, async (req, res, next) => {
  try {
    const { name, image } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const category = await Category.create({ name, image: image || null }); // Fixed: product → category
    res.status(201).json(category); // Fixed: product → category
  } catch (error) {
    next(error);
  }
});
app.post('/api/cart/add', async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: 'Invalid productId or quantity' });
    }
    const sessionId = req.sessionID;
    const userId = req.user ? req.user._id : null;
    if (!sessionId && !userId) {
      return res.status(400).json({ message: 'Session or user required' });
    }
    const product = await Product.findById(productId).select('name price images');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const query = userId ? { userId } : { sessionId };
    let cart = await Cart.findOne(query);
    if (!cart) {
      cart = new Cart({
        sessionId: userId ? undefined : sessionId,
        userId,
        items: [],
      });
    }
    const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += parseInt(quantity);
    } else {
      cart.items.push({
        productId,
        quantity: parseInt(quantity),
        productDetails: {
          name: product.name,
          price: product.price,
          images: product.images || [],
        },
      });
    }
    await cart.save();
    await cart.populateProductDetails();
    res.json({ items: cart.formattedItems });
  } catch (error) {
    console.error(`[${req.id}] Add to cart error:`, error);
    next(error);
  }
});
// Get cart
app.get('/api/cart', async (req, res, next) => {
  try {
    const sessionId = req.sessionID;
    const userId = req.user ? req.user._id : null;
    if (!sessionId && !userId) {
      return res.status(400).json({ message: 'Session or user required' });
    }
    const query = userId ? { userId } : { sessionId };
    let cart = await Cart.findOne(query);
    if (!cart) {
      cart = new Cart({
        sessionId: userId ? undefined : sessionId,
        userId,
        items: [],
      });
      await cart.save();
    }
    await cart.populateProductDetails();
    res.json({ items: cart.formattedItems });
  } catch (error) {
    console.error(`[${req.id}] Get cart error:`, error);
    next(error);
  }
});

// Update cart item quantity
app.post('/api/cart/update', async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: 'Invalid productId or quantity' });
    }
    const sessionId = req.sessionID;
    const userId = req.user ? req.user._id : null;
    if (!sessionId && !userId) {
      return res.status(400).json({ message: 'Session or user required' });
    }
    const query = userId ? { userId } : { sessionId };
    let cart = await Cart.findOne(query);
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }
    cart.items[itemIndex].quantity = parseInt(quantity);
    await cart.save();
    await cart.populateProductDetails();
    res.json({ items: cart.formattedItems });
  } catch (error) {
    console.error(`[${req.id}] Update cart error:`, error);
    next(error);
  }
});

// Remove item from cart
app.post('/api/cart/remove', async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ message: 'Invalid productId' });
    }
    const sessionId = req.sessionID;
    const userId = req.user ? req.user._id : null;
    if (!sessionId && !userId) {
      return res.status(400).json({ message: 'Session or user required' });
    }
    const query = userId ? { userId } : { sessionId };
    let cart = await Cart.findOne(query);
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    cart.items = cart.items.filter(item => item.productId.toString() !== productId);
    await cart.save();
    await cart.populateProductDetails();
    res.json({ items: cart.formattedItems });
  } catch (error) {
    console.error(`[${req.id}] Remove from cart error:`, error);
    next(error);
  }
});
app.put('/api/categories/:id', checkApiKey, async (req, res, next) => {
  try {
    const { name, image } = req.body;
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, image: image || null }, // Fixed: use provided image
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ error: 'Invalid category ID' });
    res.json(category);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/categories/:id', checkApiKey, async (req, res, next) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    await Product.updateMany({ categoryId: category._id }, { $unset: { categoryId: '' } });
    res.json({ message: `Category deleted: ${category.name}` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', checkApiKey, async (req, res, next) => {
  try {
    const orders = await Order.find()
      .populate('products.productId')
      .populate('userId', 'name email phone');
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// GET /api/testimonials
app.get('/api/testimonials', async (req, res, next) => {
  try {
    const testimonials = await Testimonial.find({ approved: true });
    const formattedTestimonials = testimonials.map(t => ({
      userId: t.userId || null,
      name: t.name || 'Anonymous', // Use Testimonial.name
      image: t.profileImage || '/placeholder.jpg',
      rating: Number(t.rating) || 5, // Ensure rating is a number, default to 5
      text: t.text || '',
      createdAt: t.createdAt,
    }));
    res.json(formattedTestimonials);
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    next(error);
  }
});

// POST /api/testimonials
app.post('/api/testimonials', async (req, res, next) => {
  try {
    const { userId, text, profileImage, rating } = req.body;
    if (!userId || !text) {
      return res.status(400).json({ error: 'Missing required fields: userId and text are required' });
    }
    // Ensure user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }
    const testimonial = await Testimonial.create({
      userId,
      text: text.trim(),
      profileImage: profileImage || null,
      rating: Math.min(Math.max(parseInt(rating) || 5, 1), 5), // Clamp rating 1–5
      approved: true, // Auto-approve for API submissions (adjust if needed)
      createdAt: Date.now(),
    });
    res.status(201).json({ message: 'Testimonial created successfully', testimonial });
  } catch (error) {
    console.error('Error creating testimonial:', error);
    next(error);
  }
});

// PUT /api/testimonials/:id
app.put('/api/testimonials/:id', checkApiKey, async (req, res, next) => {
  try {
    const { approved } = req.body;
    const testimonial = await Testimonial.findByIdAndUpdate(
      req.params.id,
      { approved: !!approved, updatedAt: Date.now() },
      { new: true }
    ).populate({
      path: 'userId',
      select: 'name',
      model: 'User',
    });
    if (!testimonial) {
      return res.status(404).json({ error: 'Testimonial not found' });
    }
    res.json({
      userId: testimonial.userId ? testimonial.userId._id : null,
      name: testimonial.userId && testimonial.userId.name ? testimonial.userId.name : 'Anonymous',
      image: testimonial.profileImage || '/placeholder.jpg',
      rating: Number(testimonial.rating) || 5,
      text: testimonial.text || '',
      approved: testimonial.approved,
      createdAt: testimonial.createdAt,
    });
  } catch (error) {
    console.error('Error updating testimonial:', error);
    next(error);
  }
});

// DELETE /api/testimonials/:id
app.delete('/api/testimonials/:id', checkApiKey, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByIdAndDelete(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: 'Testimonial not found' });
    }
    res.json({ message: `Testimonial deleted: ${testimonial.text}` });
  } catch (error) {
    console.error('Error deleting testimonial:', error);
    next(error);
  }
});

// Remove these session-based routes
app.get('/api/cart', (req, res) => {
  const cart = req.session.cart.map(item => ({
    ...item,
    product: {
      ...item.product,
      images: item.product.images || [],
      image: item.product.images[0] || null,
    },
  }));
  res.json(cart);
});

app.post('/api/cart', async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Invalid product ID or quantity' });
    }
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const cart = req.session.cart;
    const existingItem = cart.find(item => item.productId.toString() === productId.toString());
    if (existingItem) {
      existingItem.quantity += parseInt(quantity);
    } else {
      cart.push({
        productId,
        quantity: parseInt(quantity),
        product: {
          name: product.name,
          price: product.price,
          images: product.images || [],
        },
      });
    }
    req.session.cart = cart;
    res.json(cart);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/cart/:productId', (req, res) => {
  req.session.cart = req.session.cart.filter(
    item => item.productId.toString() !== req.params.productId
  );
  res.json(req.session.cart);
});

app.post('/api/orders', async (req, res, next) => {
    try {
      const { name, email, phone } = req.body;
      if (!name || !email || !phone || !req.session.cart.length) {
        return res.status(400).json({ error: 'Missing required fields or empty cart' });
      }
      if (!validator.isEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      let user = await User.findOne({ email });
      if (!user) {
        user = await User.create({ userId: uuidv4(), name, email, phone });
      }
      const products = req.session.cart.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
      }));
      const total = req.session.cart.reduce(
        (sum, item) => sum + item.product.price * item.quantity,
        0
      );
      const order = await Order.create({
        userId: user._id,
        products,
        total,
        status: 'Pending',
      });
      await order.populate('products.productId');
      req.session.cart = [];
      bot.sendMessage(
        ADMIN_CHAT_ID,
        `New Order #${order._id}\nUser: ${escapeHtml(name)} (${escapeHtml(email)}, ${escapeHtml(phone)})\nTotal: ₦${total.toFixed(2)}\nProducts:\n${products
          .map(p => `- ${escapeHtml(p.productId.name)} (Qty: ${p.quantity})`)
         .join('\n')}`,
        { parse_mode: 'HTML' }
      );
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

// Serve HTML Pages
app.get('/shop.html', (req, res) => res.redirect('/shop')); // Redirect to /shop
app.get('/shop', (req, res) => res.render('shop')); // Render shop.html
app.get('order-confirmation.html', (req, res) => res.redirect('order-confirmation')); // Redirect to /shop
app.get('/order-confirmation', (req, res) => res.render('order-confirmation')); // Render shop.html

app.post('/api/checkout', async (req, res, next) => {
  try {
    const { name, email, phone, address, notes, payment = 'cash' } = req.body;
    const allowedPayments = ['cash', 'bank_transfer'];

    // Validate required fields
    if (!name || !email || !phone || !address) {
      return res.status(400).json({
        error: 'Missing required fields',
        code: 'BAD_REQUEST',
        missingFields: { name: !name, email: !email, phone: !phone, address: !address },
      });
    }
    if (payment && !allowedPayments.includes(payment)) {
      return res.status(400).json({ error: 'Invalid payment method', code: 'INVALID_PAYMENT' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address', code: 'INVALID_EMAIL' });
    }
    if (!validator.isMobilePhone(phone, 'any') && !validator.isMobilePhone(`+234${phone.replace(/^0/, '')}`, 'any')) {
      return res.status(400).json({ error: 'Invalid phone number', code: 'INVALID_PHONE' });
    }

    const normalizedPhone = phone.startsWith('+234') ? phone : `+234${phone.replace(/^0/, '')}`;

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      const chatId = uuidv4();
      console.log('Creating user with chatId:', chatId);
      user = await User.create({
        chatId,
        name,
        email,
        phone: normalizedPhone,
      });
      console.log('User created:', user);
    }

    // Find cart
    const sessionId = req.sessionID;
    const query = req.user ? { userId: req.user._id } : { sessionId };
    let cart = await Cart.findOne(query);
    if (!cart || !cart.items.length) {
      return res.status(400).json({ error: 'Cart is empty', code: 'EMPTY_CART' });
    }

    // Calculate order totals
    const subtotal = cart.items.reduce((sum, item) => sum + item.productDetails.price * item.quantity, 0);
    const deliveryFee = 2500;
    const total = subtotal + deliveryFee;

    // Create order
    const order = new Order({
      userId: user._id,
      products: cart.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      total,
      // Additional fields for client-side compatibility
      sessionId,
      name,
      email,
      phone: normalizedPhone,
      address,
      notes: notes || '',
      payment,
      subtotal,
      deliveryFee,
      confirmed: false,
      proofOfPayment: null,
    });
    await order.save();
    console.log('Order saved:', order);

    // Store orderId in session
    req.session.orderId = order._id.toString();

    // Send Telegram notification
    const orderDetails = cart.items.map(item => `${escapeHtml(item.productDetails.name)} (Qty: ${item.quantity}) - ₦${(item.productDetails.price * item.quantity).toFixed(2)}`).join('\n');
    const message = `
      🛒 New Order #${order._id}
      Name: ${escapeHtml(name)}
      Email: ${escapeHtml(email)}
      Phone: ${escapeHtml(normalizedPhone)}
      Address: ${escapeHtml(address)}
      Notes: ${escapeHtml(notes || 'None')}
      Payment: ${escapeHtml(payment)}
      Items:
      ${orderDetails}
      Subtotal: ₦${subtotal.toFixed(2)}
      Delivery Fee: ₦${deliveryFee.toFixed(2)}
      Total: ₦${total.toFixed(2)}
      Confirm with: /confirm_${order._id}
    `;

    // Validate ADMIN_CHAT_ID before sending
    if (!process.env.ADMIN_CHAT_ID) {
      console.warn(`[${req.id}] Warning: ADMIN_CHAT_ID is not set in .env file`);
    } else {
      try {
        await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(`[${req.id}] Telegram notification sent for order #${order._id}`);
      } catch (telegramErr) {
        console.warn(`[${req.id}] Failed to send Telegram notification: ${telegramErr.message}`);
      }
    }

    // Clear cart
    cart.items = [];
    await cart.save();

    res.status(201).json({ orderId: order._id, redirectUrl: `${process.env.BASE_URL}/order-confirmation` });
  } catch (err) {
    console.error(`[${req.id}] Checkout error:`, err.stack);
    res.status(500).json({ error: 'Error placing order', code: 'SERVER_ERROR', details: err.message });
  }
});

const multer = require('multer');
const fs = require('fs').promises; // For directory creation
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'proof'); // Adjust if server.js is in a subdirectory
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PNG and JPG files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body;
  const chatId = process.env.ADMIN_CHAT_ID || '7285227786'; // Fallback to known chat ID

  try {
    if (!chatId) {
      console.error('ADMIN_CHAT_ID is not defined in environment variables');
    }

    if (!email) {
      console.error(`[${chatId}] Newsletter subscription failed: Email is required`);
      return res.status(400).json({ error: 'Email is required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error(`[${chatId}] Newsletter subscription failed: Invalid email format - ${email}`);
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const existingSubscriber = await NewsletterSubscriber.findOne({ email });
    if (existingSubscriber) {
      console.error(`[${chatId}] Newsletter subscription failed: Email already subscribed - ${email}`);
      return res.status(400).json({ error: 'Email already subscribed' });
    }
    const subscriber = await NewsletterSubscriber.create({
      email,
      userId: null, // Set to null for guest subscriptions
      subscribedAt: new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }),
    });
    console.log(`[${chatId}] Newsletter subscription successful: email=${email}`);
    const message = `<b>📩 New Newsletter Subscriber</b>\nEmail: ${email}\nTime: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}`;
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    return res.status(201).json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error(`[${chatId}] Newsletter subscription error:`, error.message);
    return res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Payment proof submission route
app.post('/api/submit-payment-proof', upload.single('paymentProof'), async (req, res, next) => {
  try {
    const sessionId = req.sessionID;
    const orderId = req.session.orderId;
    console.log(`[${req.id}] Submitting payment proof - sessionId: ${sessionId}, orderId: ${orderId}, file: ${req.file ? req.file.originalname : 'none'}`);

    if (!orderId) {
      console.log(`[${req.id}] Validation failed: No orderId in session`);
      return res.status(400).json({
        error: 'No order found in session',
        code: 'NO_ORDER',
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      console.log(`[${req.id}] Validation failed: Order not found for orderId: ${orderId}`);
      return res.status(404).json({
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      });
    }

    // Assume bank_transfer if payment is undefined (since proof is being submitted)
    const paymentMethod = order.payment || 'bank_transfer';
    if (paymentMethod !== 'bank_transfer') {
      console.log(`[${req.id}] Validation failed: Invalid payment method for orderId: ${orderId}, payment: ${paymentMethod}`);
      return res.status(400).json({
        error: 'Invalid payment method for this order',
        code: 'INVALID_PAYMENT',
      });
    }

    if (!req.file) {
      console.log(`[${req.id}] Validation failed: No file uploaded for orderId: ${orderId}`);
      return res.status(400).json({
        error: 'Payment proof file is required',
        code: 'MISSING_FILE',
      });
    }

    // Store file path in order
    const filePath = `/uploads/proof/${req.file.filename}`;
    console.log(`[${req.id}] Saving payment proof for orderId: ${orderId}, filePath: ${filePath}`);
    order.proofOfPayment = filePath; // Dynamic field
    order.status = 'Processing'; // Use valid enum value
    await order.save();

    // Send Telegram notification
    const message = `
      📸 Payment Proof Submitted for Order #${order._id}
      Name: ${escapeHtml(order.name || '')}
      Email: ${escapeHtml(order.email || '')}
      Phone: ${escapeHtml(order.phone || '')}
      Address: ${escapeHtml(order.address || '')}
      Payment Proof: ${process.env.BASE_URL}${filePath}
      Total: ₦${order.total.toFixed(2)}
      Verify with: /verify_${order._id}
    `;
    if (!process.env.ADMIN_CHAT_ID) {
      console.warn(`[${req.id}] Warning: ADMIN_CHAT_ID is not set in .env file`);
    } else {
      try {
        await bot.sendMessage(process.env.ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(`[${req.id}] Telegram notification sent for payment proof #${order._id}`);
      } catch (telegramErr) {
        console.warn(`[${req.id}] Failed to send Telegram notification: ${telegramErr.message}`);
      }
    }

    console.log(`[${req.id}] Payment proof submitted successfully for orderId: ${orderId}`);
    res.status(200).json({
      message: 'Payment proof submitted successfully',
      redirectUrl: `${process.env.BASE_URL}/order-confirmation`,
    });
  } catch (err) {
    console.error(`[${req.id}] Payment proof submission error:`, err.stack);
    if (err.code === 'ENOENT') {
      return res.status(500).json({
        error: 'Failed to create upload directory',
        code: 'UPLOAD_DIR_ERROR',
        details: err.message,
      });
    }
    if (err.message === 'Only PNG and JPG files are allowed') {
      return res.status(400).json({
        error: err.message,
        code: 'INVALID_FILE_TYPE',
      });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File size exceeds 5MB limit', 
        code: 'FILE_TOO_LARGE',
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected field name in file upload',
        code: 'INVALID_FIELD_NAME',
        details: err.message,
      });
    }
    res.status(500).json({
      error: 'Error submitting payment proof',
      code: 'SERVER_ERROR',
      details: err.message,
    });
  }
});

// Serve HTML Pages
app.get('/', (req, res) => res.render('index'));
app.get('/products', (req, res) => res.render('products'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/cart', (req, res) => res.render('cart'));
app.get('/checkout', (req, res) => res.render('checkout'));

// Error Handling
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(`[${req.id}] Error:`, err);
  res.status(500).json({ error: 'Internal server error' });
});

// Database Connection
const connectWithRetry = async () => {
  let retries = 5;
  while (retries) {
    try {
      await mongoose.connect('mongodb+srv://divineshedrack1:US4uTv5BL92SoLxX@cluster0.prx1c.mongodb.net/bazuka?retryWrites=true&w=majority', {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('Connected to MongoDB');

      // Migrate existing products to use images array
      const products = await Product.find();
      for (const product of products) {
        if (product.image && !product.images?.length) {
          await Product.updateOne(
            { _id: product._id },
            { $set: { images: [product.image] }, $unset: { image: '' } }
          );
          console.log(`Migrated product ${product.name} to use images array`);
        }
      }

      break;
    } catch (err) {
      console.error('MongoDB connection error:', err);
      retries -= 1;
      if (retries === 0) {
        console.error('Max retries reached. Exiting...');
        process.exit(1);
      }
      console.log(`Retrying connection (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

const cron = require('node-cron');

// Daily targets for metrics (adjust as needed)
const DAILY_TARGETS = {
  visitors: 100,
  orders: 10,
  subscribers: 5,
};

// Function to get today's date range in WAT (UTC+1)
const getTodayDateRange = () => {
  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
    'Africa/Lagos'
  );
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
    'Africa/Lagos'
  );
  return { startOfDay, endOfDay };
};

// Schedule daily report at 9 PM WAT (8 PM UTC)
cron.schedule(
  '0 20 * * *',
  async () => {
    const chatId = ADMIN_CHAT_ID;
    try {
      const { startOfDay, endOfDay } = getTodayDateRange();

      // Fetch daily metrics
      const visitorCount = await Visitor.countDocuments({
        visitedAt: { $gte: startOfDay, $lte: endOfDay },
      });
      const orderCount = await Order.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });
      const subscriberCount = await NewsletterSubscriber.countDocuments({
        subscribedAt: { $gte: startOfDay, $lte: endOfDay },
      });

      // Fetch previous day's metrics for comparison
      const yesterdayStart = new Date(startOfDay);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(endOfDay);
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
      const prevVisitorCount = await Visitor.countDocuments({
        visitedAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      });
      const prevOrderCount = await Order.countDocuments({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      });
      const prevSubscriberCount = await NewsletterSubscriber.countDocuments({
        subscribedAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      });

      // Build report message
      let message = `<b>📊 Daily Report - ${new Date().toLocaleDateString('en-US', {
        timeZone: 'Africa/Lagos',
      })}</b>\n`;
      message += `👀 Visitors: ${visitorCount} (Target: ${DAILY_TARGETS.visitors})\n`;
      message += `🛒 Orders: ${orderCount} (Target: ${DAILY_TARGETS.orders})\n`;
      message += `📩 Subscribers: ${subscriberCount} (Target: ${DAILY_TARGETS.subscribers})\n\n`;

      // Check for lagging performance
      const isLagging =
        visitorCount < DAILY_TARGETS.visitors ||
        orderCount < DAILY_TARGETS.orders ||
        subscriberCount < DAILY_TARGETS.subscribers;

      if (isLagging) {
       message += `⚠️ <b>Performance Alert:</b> We're below target in some areas. Consider running Instagram, TikTok, or X ads to boost engagement! Suggested platforms: <a href=" https://ads.twitter.com"> X Ads</a> or <a href="https://ads.tiktok.com">TikTok Ads</a>. 📈\n\n`;
        message += `💪 <b>Keep it up!</b> Let's tweak our strategy and aim higher tomorrow!`;
      } else {
        // Check for growth
        const hasGrowth =
          visitorCount > prevVisitorCount ||
          orderCount > prevOrderCount ||
          subscriberCount > prevSubscriberCount;

        if (hasGrowth) {
          message += `🎉 <b>Congratulations!</b> We've seen growth today! Keep up the amazing work! 🚀\n\n`;
        } else {
          message += `😊 <b>Steady Progress:</b> We're holding strong! Let's keep engaging our audience and aim for growth tomorrow! 💪`;
        }
      }

      // Send report to admin
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      console.log(
        `[${chatId}] Daily report sent: Visitors=${visitorCount}, Orders=${orderCount}, Subscribers=${subscriberCount}`
      );
    } catch (error) {
      console.error(`[${chatId}] Daily report error:`, error);
      await bot.sendMessage(chatId, 'Error generating daily report.', {
        parse_mode: 'HTML',
      });
    }
  },
  {
    timezone: 'Africa/Lagos', // WAT timezone
  }
);
// Start Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await connectWithRetry();
});
