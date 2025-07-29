const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Cart = require('../models/Cart');
const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const schedule = require('node-schedule');

dotenv.config();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Validate environment variables
const requiredEnv = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'SESSION_SECRET'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`Missing environment variable: ${env}`);
    process.exit(1);
  }
}

// Helper: Escape HTML for Telegram messages
const escapeHtml = (text) => String(text).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

// Helper: Format currency
const formatCurrency = (amount) => `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;

// Helper: Get base URL from request
const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// Schedule Reminder for Unconfirmed Orders
function scheduleOrderReminder(orderId, chatId) {
  const reminderDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  schedule.scheduleJob(`reminder_${orderId}`, reminderDate, async () => {
    try {
      const order = await Order.findById(orderId);
      if (!order || order.confirmed) return;

      const message = `
        🔔 Reminder: Order #${order._id} is still unconfirmed!
        Name: ${escapeHtml(order.name)}
        Email: ${escapeHtml(order.email)}
        Phone: ${escapeHtml(order.phone)}
        Total: ${formatCurrency(order.total)}
        Please confirm: /confirm_${order._id}
      `;
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      console.log(`Sent reminder for order ${orderId}`);
    } catch (error) {
      console.error(`Error sending reminder for order ${orderId}:`, error);
    }
  });
}

// Telegram Command to Confirm Order
bot.onText(/\/confirm_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const orderId = match[1];

  if (chatId != ADMIN_CHAT_ID) {
    return bot.sendMessage(chatId, 'Unauthorized.', { parse_mode: 'HTML' });
  }

  try {
    const order = await Order.findById(orderId);
    if (!order) {
      return bot.sendMessage(chatId, `Order #${orderId} not found.`, { parse_mode: 'HTML' });
    }
    if (order.confirmed) {
      return bot.sendMessage(chatId, `Order #${orderId} already confirmed.`, { parse_mode: 'HTML' });
    }

    order.confirmed = true;
    order.status = 'Processing';
    await order.save();

    const job = schedule.scheduledJobs[`reminder_${orderId}`];
    if (job) job.cancel();

    bot.sendMessage(chatId, `Order #${orderId} confirmed successfully!`, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`Error confirming order ${orderId}:`, error);
    bot.sendMessage(chatId, 'Error confirming order.', { parse_mode: 'HTML' });
  }
});

// Checkout Route
router.post('/', async (req, res) => {
  const { name, email, phone, address, notes, cart } = req.body;

  console.log('Received checkout request:', req.body); // Debug log

  // Validate required fields
  if (!name || !email || !phone || !address || !cart || !Array.isArray(cart) || !cart.length) {
    return res.status(400).json({
      error: 'Missing or invalid required fields',
      code: 'BAD_REQUEST',
      missingFields: {
        name: !name,
        email: !email,
        phone: !phone,
        address: !address,
        cart: !cart || !Array.isArray(cart) || !cart.length,
      },
    });
  }

  // Validate cart items
  for (const item of cart) {
    if (!item.productId || !item.name || !item.price || !item.quantity) {
      return res.status(400).json({
        error: 'Invalid cart item format',
        code: 'INVALID_CART',
      });
    }
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address', code: 'INVALID_EMAIL' });
  }

  const normalizedPhone = phone.startsWith('+234') ? phone : `+234${phone.replace(/^0/, '')}`;
  if (!validator.isMobilePhone(normalizedPhone, 'any')) {
    return res.status(400).json({ error: 'Invalid phone number', code: 'INVALID_PHONE' });
  }

  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ userId: uuidv4(), name, email, phone: normalizedPhone });
    }

    const sessionId = req.sessionID;
    const userId = user._id;
    const query = userId ? { userId } : { sessionId };
    const existingCart = await Cart.findOne(query);
    if (!existingCart || !existingCart.items.length) {
      return res.status(400).json({ error: 'Cart is empty in session', code: 'EMPTY_CART' });
    }

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryFee = 2500;
    const total = subtotal + deliveryFee;

    const order = new Order({
      userId: user._id,
      name,
      email,
      phone: normalizedPhone,
      address,
      notes: notes || '',
      products: cart.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      })),
      subtotal,
      deliveryFee,
      total,
      status: 'Pending',
      confirmed: false,
    });
    await order.save();

    const telegramMessage = `
      🛒 New Order #${order._id}
      Name: ${escapeHtml(name)}
      Email: ${escapeHtml(email)}
      Phone: ${escapeHtml(normalizedPhone)}
      Address: ${escapeHtml(address)}
      Notes: ${escapeHtml(notes || 'None')}
      Items:
      ${cart.map(item => `${escapeHtml(item.name)} (Qty: ${item.quantity}) - ${formatCurrency(item.price * item.quantity)}`).join('\n')}
      Subtotal: ${formatCurrency(subtotal)}
      Delivery Fee: ${formatCurrency(deliveryFee)}
      Total: ${formatCurrency(total)}
      💳 Payment: Contact customer support for payment instructions (Cash on Delivery).
      Confirm with: /confirm_${order._id}
    `;

    await bot.sendMessage(ADMIN_CHAT_ID, telegramMessage, { parse_mode: 'HTML' });
    scheduleOrderReminder(order._id, ADMIN_CHAT_ID);
    await Cart.findOneAndUpdate(query, { items: [] });

    res.status(201).json({
      orderId: order._id,
      redirectUrl: `${getBaseUrl(req)}/order-confirmation?orderId=${order._id}`,
    });
  } catch (err) {
    console.error(`[${req.id}] Checkout error:`, err.stack);
    res.status(500).json({ error: 'Error placing order', code: 'SERVER_ERROR', details: err.message });
  }
});

// Order Confirmation Page Route
router.get('/order-confirmation', async (req, res) => {
  const { orderId } = req.query;
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    console.error(`[Order Confirmation] Invalid order ID: ${orderId}`);
    return res.status(400).render('error', { error: 'Invalid order ID' });
  }

  try {
    const order = await Order.findById(orderId).populate('products.productId');
    if (!order) {
      console.error(`[Order Confirmation] Order not found: ${orderId}`);
      return res.status(404).render('error', { error: 'Order not found' });
    }
    res.render('order-confirmation', {
      order,
      formatCurrency,
      escapeHtml,
    });
  } catch (err) {
    console.error(`[${req.id}] Order confirmation error:`, err.stack);
    res.status(500).render('error', { error: 'Error loading order confirmation' });
  }
});

module.exports = router;