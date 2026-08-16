# M-Pesa STK Push Node.js API

## Setup
1. Clone repo
2. `npm install`
3. Create `.env` with your Daraja credentials
4. Run `npm start`

## Endpoints
- `POST /stkpush` - Initiate payment (body: phone, amount, accountRef, description)
- `POST /mpesa/callback` - Safaricom callback webhook

## Testing
- Use ngrok: `ngrok http 3000`
- Update `CALLBACK_URL` in .env with ngrok URL
