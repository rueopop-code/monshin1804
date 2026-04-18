require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'monshin-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'products.db');

// ─── Ensure data dir ───
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ─── Database Setup ───
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    cat         TEXT    NOT NULL DEFAULT 'ทั่วไป',
    price       TEXT    DEFAULT '',
    description TEXT    DEFAULT '',
    img_data    TEXT    NOT NULL,
    ai_tagged   INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch('now') * 1000),
    updated_at  INTEGER DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS shop_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_products_cat ON products(cat);
  CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);
`);

// ─── Middleware ───
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-secret']
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Rate limiter — upload endpoints
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 60 });

// ─── Auth Middleware ───
function requireAuth(req, res, next) {
  const secret = req.headers['x-api-secret'] || req.query.secret;
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Multer (memory) ───
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// ─── Image Compression ───
async function compressImage(buffer, mimetype) {
  const compressed = await sharp(buffer)
    .resize({ width: 700, height: 700, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString('base64')}`;
}

// ════════════════════════════════
//  PUBLIC ROUTES (no auth)
// ════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'monshinsupply API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// GET /api/products — list all (public read)
app.get('/api/products', (req, res) => {
  try {
    const { search, cat, limit = 500, offset = 0 } = req.query;
    let query = 'SELECT id, name, cat, price, description, img_data, ai_tagged, created_at, updated_at FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR cat LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (cat && cat !== 'ทั้งหมด') {
      query += ' AND cat = ?';
      params.push(cat);
    }

    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const products = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
    const categories = db.prepare('SELECT DISTINCT cat FROM products ORDER BY cat').all().map(r => r.cat);

    res.json({ products, total, categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/products/:id
app.get('/api/products/:id', (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings — shop settings (public)
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM shop_settings').all();
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════
//  PROTECTED ROUTES (auth required)
// ════════════════════════════════

// POST /api/products — add product (with file upload)
app.post('/api/products', requireAuth, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    let img_data;

    if (req.file) {
      // multipart/form-data upload
      img_data = await compressImage(req.file.buffer, req.file.mimetype);
    } else if (req.body.img) {
      // base64 from body
      img_data = req.body.img;
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { name = 'สินค้าใหม่', cat = 'ทั่วไป', price = '', description = '', ai_tagged = 0 } = req.body;

    const result = db.prepare(`
      INSERT INTO products (name, cat, price, description, img_data, ai_tagged)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, cat, price, description, img_data, ai_tagged ? 1 : 0);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products/bulk — upload multiple base64 images at once
app.post('/api/products/bulk', requireAuth, uploadLimiter, async (req, res) => {
  try {
    const { items } = req.body; // [{ name, cat, price, description, img, ai_tagged }]
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }

    const inserted = [];
    const insertStmt = db.prepare(`
      INSERT INTO products (name, cat, price, description, img_data, ai_tagged)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const r = insertStmt.run(
          item.name || 'สินค้าใหม่',
          item.cat || 'ทั่วไป',
          item.price || '',
          item.description || '',
          item.img || '',
          item.ai_tagged ? 1 : 0
        );
        inserted.push(r.lastInsertRowid);
      }
    });

    insertMany(items);
    res.status(201).json({ inserted: inserted.length, ids: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/products/:id — update product
app.put('/api/products/:id', requireAuth, (req, res) => {
  try {
    const { name, cat, price, description } = req.body;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    db.prepare(`
      UPDATE products SET
        name = ?, cat = ?, price = ?, description = ?,
        updated_at = unixepoch('now') * 1000
      WHERE id = ?
    `).run(
      name ?? existing.name,
      cat ?? existing.cat,
      price ?? existing.price,
      description ?? existing.description,
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', requireAuth, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products — clear all
app.delete('/api/products', requireAuth, (req, res) => {
  try {
    const { changes } = db.prepare('DELETE FROM products').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name='products'").run();
    res.json({ deleted: changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settings — save shop settings (name, logo)
app.put('/api/settings', requireAuth, (req, res) => {
  try {
    const upsert = db.prepare('INSERT OR REPLACE INTO shop_settings (key, value) VALUES (?, ?)');
    const upsertMany = db.transaction((pairs) => {
      for (const [k, v] of pairs) upsert.run(k, v);
    });
    upsertMany(Object.entries(req.body));
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export — export all data as JSON
app.get('/api/export', requireAuth, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY created_at ASC').all();
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM shop_settings').all().map(r => [r.key, r.value])
    );
    res.json({ products, settings, exported_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 404 handler ───
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── Error handler ───
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`✅ monshinsupply API running on port ${PORT}`);
  console.log(`📦 Database: ${DB_PATH}`);
  console.log(`🔑 API Secret: ${API_SECRET.slice(0, 8)}...`);
});
