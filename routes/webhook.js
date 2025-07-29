// routes/webhook.js
const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.orderId) {
      return res.status(400).json({ error: 'Invalid webhook payload', code: 'BAD_REQUEST' });
    }

    // TODO: Process Opay webhook (e.g., update order status)
    console.log('Received webhook:', payload);
    // Example: await Order.findByIdAndUpdate(payload.orderId, { paymentStatus: payload.status });

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Error processing webhook', code: 'SERVER_ERROR' });
  }
});

module.exports = router;