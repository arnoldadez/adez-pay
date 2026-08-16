const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Transaction = require('./models/Transaction');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend

// ==================== DB CONNECTION ====================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ==================== UTILITIES ====================
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

// ==================== GET TOKEN ====================
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

// ==================== STK PUSH ====================
app.post('/api/stkpush', async (req, res) => {
  try {
    const { phone, amount, accountRef, description } = req.body;

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

    // Save to DB
    await Transaction.create({
      checkoutRequestID: response.data.CheckoutRequestID,
      merchantRequestID: response.data.MerchantRequestID,
      phone,
      amount: Number(amount),
      accountReference: accountRef || 'TestPayment',
      transactionDesc: description || 'M-Pesa Payment',
      status: 'PENDING'
    });

    res.status(200).json({
      success: true,
      checkoutRequestID: response.data.CheckoutRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription
    });

  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ error: 'STK Push failed', details: error.response?.data });
  }
});

// ==================== CALLBACK ====================
app.post('/api/mpesa/callback', async (req, res) => {
  console.log('Callback received');

  const { Body } = req.body;
  if (Body?.stkCallback) {
    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = Body.stkCallback;

    const updateData = {
      status: ResultCode === 0 ? 'SUCCESS' : 'FAILED',
      resultDesc: ResultDesc,
      updatedAt: new Date()
    };

    if (ResultCode === 0) {
      const meta = CallbackMetadata?.Item || [];
      const getMeta = (key) => meta.find(item => item.Name === key)?.Value;
      updateData.mpesaReceiptNumber = getMeta('MpesaReceiptNumber');
      updateData.transactionDate = getMeta('TransactionDate');
    }

    await Transaction.findOneAndUpdate(
      { checkoutRequestID: CheckoutRequestID },
      updateData
    );
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ==================== GET TRANSACTIONS ====================
app.get('/api/transactions', async (req, res) => {
  const transactions = await Transaction.find().sort({ createdAt: -1 });
  res.json(transactions);
});

// ==================== FRONTEND ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
