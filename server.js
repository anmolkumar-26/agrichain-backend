const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "agrichain",
  password: "abaa123",   // 👉 your real password
  port: 5432,
});

// ── Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ── Auth Middleware ───────────────────────────────────────
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ══════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, state, district, role, password } = req.body;
  if (!name || !phone || !role || !password)
    return res.status(400).json({ error: 'name, phone, role, password are required' });
  if (!['farmer', 'buyer'].includes(role))
    return res.status(400).json({ error: 'role must be farmer or buyer' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (exists.rows.length) return res.status(409).json({ error: 'Phone already registered' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, phone, state, district, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, phone, role`,
      [name, phone, state, district, role, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// LISTINGS ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/listings — public, filterable
app.get('/api/listings', async (req, res) => {
  const { crop, state, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const values = [];
  let where = 'WHERE l.is_active = true';

  if (crop)   { values.push(crop.toLowerCase());  where += ` AND l.crop = $${values.length}`; }
  if (state)  { values.push(state);               where += ` AND u.state ILIKE $${values.length}`; }
  if (search) {
    values.push(`%${search}%`);
    where += ` AND (u.name ILIKE $${values.length} OR l.crop ILIKE $${values.length} OR u.district ILIKE $${values.length})`;
  }

  try {
    const query = `
      SELECT l.id, u.name, u.state, u.district, u.phone, u.verified,
             l.crop, l.quantity_quintal, l.price_display, l.created_at
      FROM listings l
      JOIN users u ON u.id = l.farmer_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const countQuery = `SELECT COUNT(*) FROM listings l JOIN users u ON u.id = l.farmer_id ${where}`;
    const [rows, count] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, values.slice(0, -2)),
    ]);

    res.json({ listings: rows.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings — farmer only
app.post('/api/listings', authenticate, async (req, res) => {
  if (req.user.role !== 'farmer')
    return res.status(403).json({ error: 'Only farmers can post listings' });

  const { crop, quantity_quintal, price_display, notes } = req.body;
  if (!crop || !quantity_quintal || !price_display)
    return res.status(400).json({ error: 'crop, quantity_quintal, price_display required' });

  try {
    const result = await pool.query(
      `INSERT INTO listings (farmer_id, crop, quantity_quintal, price_display, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, crop.toLowerCase(), quantity_quintal, price_display, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/listings/:id — own listing only
app.delete('/api/listings/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE listings SET is_active = false WHERE id = $1 AND farmer_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Listing not found or unauthorized' });
    res.json({ message: 'Listing removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// CROPS / PRICES ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/crops — live price board
app.get('/api/crops', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM crop_prices ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// BUYER REQUIREMENTS ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/requirements — public
app.get('/api/requirements', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as buyer_name, u.state
       FROM requirements r JOIN users u ON u.id = r.buyer_id
       WHERE r.is_active = true ORDER BY r.created_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/requirements — buyer only
app.post('/api/requirements', authenticate, async (req, res) => {
  if (req.user.role !== 'buyer')
    return res.status(403).json({ error: 'Only buyers can post requirements' });

  const { crop, quantity_quintal, max_price, delivery_state, notes } = req.body;
  if (!crop || !quantity_quintal)
    return res.status(400).json({ error: 'crop and quantity_quintal required' });

  try {
    const result = await pool.query(
      `INSERT INTO requirements (buyer_id, crop, quantity_quintal, max_price, delivery_state, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, crop.toLowerCase(), quantity_quintal, max_price, delivery_state, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// CONTACT / LEAD TRACKING
// ══════════════════════════════════════════════════════════

// POST /api/contact — log when a buyer contacts a farmer
app.post('/api/contact', authenticate, async (req, res) => {
  const { listing_id } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });
  try {
    await pool.query(
      'INSERT INTO contacts (buyer_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, listing_id]
    );
    res.json({ message: 'Contact logged' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

app.listen(PORT, () => console.log(`AgriChain API running on port ${PORT}`));
module.exports = app;