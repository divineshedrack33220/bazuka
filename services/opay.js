const axios = require('axios');

async function initiateOpayPayment(order) {
  try {
    const payload = {
      merchantId: process.env.OPAY_MERCHANT_ID,
      reference: order._id.toString(), // Use _id from Mongoose model
      amount: order.total * 100, // Convert to kobo
      currency: 'NGN',
      country: 'NG',
      customerEmail: order.email,
      customerPhone: order.phone,
      callbackUrl: `${process.env.BASE_URL}/api/checkout/callback`,
      returnUrl: `${process.env.BASE_URL}/order-confirmation?orderId=${order._id}`,
      description: `Order #${order._id} from MyHomeBasics`,
    };

    const response = await axios.post('https://api.opayweb.com/api/v3/checkout/initialize', payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.data.status === 'success') {
      return {
        status: 'success',
        redirectUrl: response.data.data.checkoutUrl,
      };
    } else {
      throw new Error(response.data.message || 'Opay payment initiation failed');
    }
  } catch (error) {
    console.error('Opay payment error:', error.message);
    return {
      status: 'error',
      redirectUrl: null,
      error: error.message,
    };
  }
}