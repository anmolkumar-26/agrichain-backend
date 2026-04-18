-- ═══════════════════════════════════════════════════════
-- AgriChain — PostgreSQL Schema
-- Run this file once to set up your database:
--   psql $DATABASE_URL -f schema.sql
-- ═══════════════════════════════════════════════════════

-- Users (farmers + buyers)
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  phone           VARCHAR(15) UNIQUE NOT NULL,  -- format: 91XXXXXXXXXX
  state           VARCHAR(80),
  district        VARCHAR(80),
  role            VARCHAR(10) NOT NULL CHECK (role IN ('farmer', 'buyer')),
  password_hash   TEXT NOT NULL,
  verified        BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Crop listings posted by farmers
CREATE TABLE IF NOT EXISTS listings (
  id                SERIAL PRIMARY KEY,
  farmer_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop              VARCHAR(60) NOT NULL,
  quantity_quintal  NUMERIC(10,2) NOT NULL,
  price_display     VARCHAR(40) NOT NULL,  -- e.g. "₹2,100/q"
  notes             TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listings_crop ON listings(crop);
CREATE INDEX IF NOT EXISTS idx_listings_farmer ON listings(farmer_id);

-- Live crop price board
CREATE TABLE IF NOT EXISTS crop_prices (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(60) UNIQUE NOT NULL,
  emoji     VARCHAR(8),
  price     VARCHAR(40) NOT NULL,   -- display string
  demand    VARCHAR(60),
  level     VARCHAR(4) CHECK (level IN ('high','med','low')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buyer requirements
CREATE TABLE IF NOT EXISTS requirements (
  id                SERIAL PRIMARY KEY,
  buyer_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop              VARCHAR(60) NOT NULL,
  quantity_quintal  NUMERIC(10,2) NOT NULL,
  max_price         VARCHAR(40),
  delivery_state    VARCHAR(80),
  notes             TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Contact events (buyer taps WhatsApp/call on a listing)
CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  buyer_id    INTEGER NOT NULL REFERENCES users(id),
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(buyer_id, listing_id)
);

-- ─── Seed crop prices ───────────────────────────────────
INSERT INTO crop_prices (name, emoji, price, demand, level) VALUES
  ('Wheat',     '🌾', '₹2,150/q',  'High demand',       'high'),
  ('Rice',      '🍚', '₹1,980/q',  'Ready to sell',     'high'),
  ('Tomato',    '🍅', '₹28/kg',    'Seasonal',          'med'),
  ('Cotton',    '🪴', '₹6,200/q',  'Export ready',      'high'),
  ('Sugarcane', '🎋', '₹350/q',    'Bulk orders',       'med'),
  ('Onion',     '🧅', '₹22/kg',    'High demand',       'high'),
  ('Potato',    '🥔', '₹18/kg',    'Available now',     'med'),
  ('Maize',     '🌽', '₹1,750/q',  'Moderate',          'med'),
  ('Soybean',   '🫘', '₹4,600/q',  'Processors needed', 'high'),
  ('Groundnut', '🥜', '₹5,800/q',  'Export ready',      'high'),
  ('Mango',     '🥭', '₹45/kg',    'Seasonal',          'high'),
  ('Turmeric',  '🌿', '₹12,000/q', 'Spice exporters',   'med')
ON CONFLICT (name) DO NOTHING;
