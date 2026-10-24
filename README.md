# 🌿 SetuMoolya (सेतुमूल्य) - Backend Auth & Authorization Engine

> **"Every Root Deserves Its Worth"**  
> AgriTech Platform connecting rural wild-herb foragers & FPOs directly with verified global B2B buyers through fair pricing, lab verification, and escrow settlement.

---

## 🚀 Quick Start Guide

### 1. Database Setup with Supabase
1. Log into your [Supabase Dashboard](https://supabase.com/dashboard) and create or select your project.
2. Navigate to the **SQL Editor** tab on the left menu.
3. Open [`supabase_schema.sql`](./supabase_schema.sql) in this directory, copy its entire contents, paste it into the Supabase SQL Editor, and click **Run**.
   - This sets up the `user_role` enum (`farmer`, `fpo`, `buyer`, `lab`, `logistics`, `admin`).
   - Creates the `public.profiles` table with automatic triggers linked to `auth.users`.
   - Enables Row Level Security (RLS) policies.

### 2. Configure Environment Variables
Open the `.env` file in `D:\SetuMoolya\backend\.env`:
```env
PORT=5000
NODE_ENV=development

# Get from Supabase Project Settings -> API
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_public_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_secret_key

CLIENT_URL=http://localhost:3000
```

### 3. Run the Backend Server
```bash
# Start with live reloading (Nodemon)
npm run dev

# Or start directly with Node
node src/index.js
```

---

## 🛡️ User Roles & Permissions Matrix

| Role | Name | Description | Key Capabilities |
| :--- | :--- | :--- | :--- |
| `farmer` | Forager / Cultivator | Village-level herb collector | List harvests, check fair bio-compound pricing, track quota |
| `fpo` | Village Cooperative / FPO | Aggregates harvests into bulk lots | Aggregate lots, dispatch lab samples, assign payouts |
| `buyer` | Verified B2B Buyer | Global/domestic wellness & pharma brands | Browse verified lots, order samples, deposit escrow, track shipments |
| `lab` | Testing Laboratory | AYUSH / NABL certified quality labs | Receive samples, test bio-compounds (HPLC), issue tamper-evident COA |
| `logistics` | Transport / Cold-Chain | Shipping & export partners | Update waybills, cold-chain telemetry, customs clearance |
| `admin` | Platform Admin / Agronomist | System oversight & conservation | Manage quotas, approve KYC, mediate disputes, platform health |

---

## 📡 API Endpoints Reference

### Public Routes
- `POST /api/auth/register` - Register a new user with metadata (`role`, `full_name`, `phone`, `organization_name`, etc.)
- `POST /api/auth/login` - Sign in with email and password to receive Supabase JWT and profile
- `POST /api/auth/refresh` - Refresh an expired access token using `refresh_token`

### Protected Routes (Requires Header: `Authorization: Bearer <token>`)
- `GET /api/auth/me` - Fetch authenticated user profile & permissions
- `PUT /api/auth/me` - Update profile information (phone, bank details, location, bio specialization)
- `POST /api/auth/logout` - Invalidate current session

### Role-Protected Endpoints
- `GET /api/auth/test/farmer-portal` - Accessible to `farmer` and `fpo`
- `GET /api/auth/test/buyer-escrow` - Accessible only to verified `buyer`
- `GET /api/auth/test/lab-certification` - Accessible to certified `lab`
- `GET /api/auth/admin/users` - Accessible to `admin` (lists all users with KYC filters)
- `PUT /api/auth/admin/users/:userId/kyc` - Accessible to `admin` (approve/reject user verification)

---

## 📝 Sample API Requests & Responses

### 1. Register a Farmer or Buyer
**POST** `/api/auth/register`
```json
{
  "email": "ramesh.farmer@setumoolya.org",
  "password": "SecurePassword123!",
  "full_name": "Ramesh Chandra Sharma",
  "role": "farmer",
  "phone": "+919876543210",
  "organization_name": "Chamoli Herb Collectors Co-op",
  "bio_specialization": "Kutki, Gucchi, Ashwagandha",
  "location": {
    "state": "Uttarakhand",
    "district": "Chamoli",
    "village": "Joshimath"
  },
  "bank_details": {
    "account_number": "123456789012",
    "ifsc_code": "SBIN0001234",
    "upi_id": "ramesh@upi"
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "User registered successfully.",
  "data": {
    "user": {
      "id": "e2a4a754-0610-449e-b98a-72e5ea4e4128",
      "email": "ramesh.farmer@setumoolya.org",
      "role": "farmer",
      "full_name": "Ramesh Chandra Sharma",
      "is_verified": false,
      "kyc_status": "pending"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 2. Login
**POST** `/api/auth/login`
```json
{
  "email": "ramesh.farmer@setumoolya.org",
  "password": "SecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Authentication successful.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "v1.mc3f...",
    "expiresIn": 3600,
    "user": {
      "id": "e2a4a754-0610-449e-b98a-72e5ea4e4128",
      "email": "ramesh.farmer@setumoolya.org",
      "role": "farmer",
      "full_name": "Ramesh Chandra Sharma",
      "phone": "+919876543210",
      "is_verified": false,
      "kyc_status": "pending"
    }
  }
}
```
