const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// ==================== UTILITY ====================
const getTimestamp = () => {
  const now = new Date();
  return now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
};

const getPassword = (shortcode, passkey, timestamp) => {
  return Buffer.from(shortcode + passkey + timestamp).toString('base64');
};

// ==================== GET ACCESS TOKEN ====================
const getAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return response.data.access_token;
};

// ==================== STK PUSH ENDPOINT ====================
app.post('/stkpush', async (req, res) => {
  try {
    const { phone, amount, accountRef, description } = req.body;

    // Validate inputs
    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required' });
    }

    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = getPassword(
      process.env.SHORTCODE,
      process.env.PASSKEY,
      timestamp
    );

    const payload = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: accountRef || 'TestPayment',
      TransactionDesc: description || 'M-Pesa Payment'
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Store CheckoutRequestID in DB here
    console.log('STK Push sent:', response.data);
    res.status(200).json({
      success: true,
      checkoutRequestID: response.data.CheckoutRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription,
      merchantRequestID: response.data.MerchantRequestID
    });

  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ error: 'STK Push failed', details: error.response?.data });
  }
});

// ==================== CALLBACK HANDLER ====================
app.post('/mpesa/callback', (req, res) => {
  console.log('Callback received:', JSON.stringify(req.body, null, 2));

  const { Body } = req.body;
  if (Body?.stkCallback) {
    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = Body.stkCallback;

    if (ResultCode === 0) {
      // SUCCESS - parse metadata
      const meta = CallbackMetadata?.Item || [];
      const getMeta = (key) => meta.find(item => item.Name === key)?.Value;

      const transaction = {
        checkoutID: CheckoutRequestID,
        amount: getMeta('Amount'),
        mpesaReceipt: getMeta('MpesaReceiptNumber'),
        phone: getMeta('PhoneNumber'),
        date: getMeta('TransactionDate'),
        result: 'SUCCESS'
      };

      console.log('✅ Payment successful:', transaction);
      // Update DB with successful transaction here

    } else {
      // FAILED
      console.log('❌ Payment failed:', ResultDesc);
      // Update DB with failure here
    }
  }

  // Always respond with success to Safaricom
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 M-Pesa STK Push server running on port ${PORT}`);
});
