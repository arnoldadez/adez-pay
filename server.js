const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Transaction = require('./models/Transaction');
const User = require('./models/User');
const { protect } = require('./middleware/auth');

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

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

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ error: 'Email already exists' });

    const user = await User.create({ name, email, password });
    res.status(201).json({ message: 'User created', user: { id: user._id, name, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Login successful', user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// ==================== STK PUSH ====================
app.post('/api/stkpush', protect, async (req, res) => {
  try {
    const { phone, amount, accountRef, description } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: 'Phone and amount are required' });

    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = getPassword(process.env.SHORTCODE, process.env.PASSKEY, timestamp);

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

    await Transaction.create({
      userId: req.user.id,
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

    await Transaction.findOneAndUpdate({ checkoutRequestID: CheckoutRequestID }, updateData);
  }
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ==================== GET TRANSACTIONS ====================
app.get('/api/transactions', protect, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json(transactions);
});

// ==================== FRONTEND ====================
app.get('/dashboard', protect, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

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

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ error: 'Email already exists' });

    const user = await User.create({ name, email, password });
    res.status(201).json({ message: 'User created', user: { id: user._id, name, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Login successful', user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// ==================== STK PUSH ====================
app.post('/api/stkpush', protect, async (req, res) => {
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

    // Save to DB with userId
    await Transaction.create({
      userId: req.user.id,
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
app.get('/api/transactions', protect, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json(transactions);
});

// ==================== FRONTEND ====================
app.get('/dashboard', protect, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
