# CanteenGo

Web app for college-canteen ordering (SRS v1.1). Students order from a mobile-first PWA; staff and the owner use the same app's role-based screens.

- `backend/`: Node.js + Express REST API, MongoDB, Firebase Auth/FCM, Razorpay. Runs locally or on AWS Lambda.
- `frontend/`: Vite + React PWA (student, staff and owner screens).
- `infra/`: AWS SAM template (Lambda + HTTP API + 1-minute payment-timeout schedule). Not yet deployed or validated.

## Run locally

```bash
cd backend && cp .env.example .env   # fill in Mongo, Firebase, Razorpay test keys
npm install && npm test              # 33 tests, no external services needed
npm run dev
```

```bash
cd frontend && cp .env.example .env  # Firebase web config + VITE_API_URL
npm install && npm run dev
```

## What is implemented

| SRS area | Status |
|---|---|
| Auth (REQ-1–4), roles, owner grants staff | done, tested |
| Menu, search, cart, server-side re-validation (REQ-5–9) | done, tested |
| Slots, checkout, payment verify, idempotency, timeout, refund (REQ-10–20) | done, tested against a fake gateway |
| Order lifecycle, push on Ready, history (REQ-21–24) | done, tested; FCM web push client not wired yet |
| Offers (REQ-25–28) | done; offline cache of menu/offers only |
| Bulk upload (REQ-29, 31–33) | CSV done; **PDF (REQ-30) not done** |
| Feedback, ratings, owner reports (REQ-34–37) | done, tested |
| Audit log of admin actions | done |

Not yet verified against real services: MongoDB Atlas, Firebase, Razorpay, Lambda.

## AWS free-tier setup checklist

1. Billing: create a $1–5 monthly **Budget** alert before anything else.
2. Secure the root user with MFA; do daily work with an IAM Identity Center or IAM admin user (no long-term keys in code or GitHub).
3. MongoDB Atlas M0 (free) in an AWS region near you (e.g. Mumbai). Allow access from Lambda.
4. Firebase project (free): enable Email/Password auth, generate a service-account key, store it as a secret, never in git.
5. Razorpay: use **test mode** keys; add a webhook to `<ApiUrl>/api/payments/webhook` for `payment.captured` and `payment.failed`.
6. Deploy the backend with `sam build && sam deploy --guided` from `infra/`.
7. Host `frontend/dist` on S3 + CloudFront (or Amplify Hosting); set `CORS_ORIGIN` to that URL.
