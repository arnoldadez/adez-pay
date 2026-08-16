const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  checkoutRequestID: { type: String, required: true, unique: true },
  merchantRequestID: String,
  phone: String,
  amount: Number,
  accountReference: String,
  transactionDesc: String,
  status: { 
    type: String, 
    enum: ['PENDING', 'SUCCESS', 'FAILED'], 
    default: 'PENDING' 
  },
  mpesaReceiptNumber: String,
  transactionDate: Date,
  resultDesc: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
