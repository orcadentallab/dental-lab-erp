# Dental Lab Backend API

Traditional Express.js backend (standalone, not connected to the main app).

## 🚀 Quick Start

```bash
cd backend
npm install
npm run dev
```

Server will run on `http://localhost:3001`

## 📋 Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info |
| GET | `/health` | Health check |
| GET | `/api/orders` | List all orders |
| POST | `/api/orders` | Create order |
| GET | `/api/orders/:id` | Get order |
| PUT | `/api/orders/:id` | Update order |
| DELETE | `/api/orders/:id` | Delete order |
| GET | `/api/doctors` | List all doctors |
| POST | `/api/doctors` | Create doctor |
| GET | `/api/doctors/:id` | Get doctor |
| PUT | `/api/doctors/:id` | Update doctor |
| DELETE | `/api/doctors/:id` | Delete doctor |
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | Get user |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |

## 📁 Structure

```
backend/
├── src/
│   ├── server.js      # Main entry point
│   └── routes/
│       ├── orders.js  # Orders CRUD
│       ├── doctors.js # Doctors CRUD
│       └── users.js   # Users CRUD
├── package.json
└── .env.example
```
