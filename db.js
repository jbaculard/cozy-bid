const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'auctions.db');

let db = null;

// Initialize database
async function initDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  // Initialize schema
  db.run(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      item_url TEXT,
      seat_a_token TEXT NOT NULL UNIQUE,
      seat_b_token TEXT NOT NULL UNIQUE,
      commit_a TEXT,
      commit_b TEXT,
      bid_a REAL,
      bid_b REAL,
      secret_a TEXT,
      secret_b TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  saveDb();
  return db;
}

// Save database to disk
function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('Error saving database:', e.message);
  }
}

// Generate cryptographically secure random token (128+ bits)
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function generateAuctionId() {
  return crypto.randomBytes(12).toString('base64url');
}

function createAuction(title, description, itemUrl) {
  const id = generateAuctionId();
  const seatAToken = generateToken();
  const seatBToken = generateToken();

  db.run(`
    INSERT INTO auctions (id, title, description, item_url, seat_a_token, seat_b_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, title, description || null, itemUrl || null, seatAToken, seatBToken]);

  saveDb();
  return { id, seatAToken, seatBToken };
}

function getAuctionBySeatToken(auctionId, seatToken) {
  const stmt = db.prepare(`
    SELECT * FROM auctions WHERE id = ? AND (seat_a_token = ? OR seat_b_token = ?)
  `);
  stmt.bind([auctionId, seatToken, seatToken]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();

  const seat = row.seat_a_token === seatToken ? 'A' : 'B';
  return { auction: row, seat };
}

function getAuctionById(auctionId) {
  const stmt = db.prepare('SELECT * FROM auctions WHERE id = ?');
  stmt.bind([auctionId]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

function setCommit(auctionId, seat, commit) {
  const column = seat === 'A' ? 'commit_a' : 'commit_b';
  db.run(`UPDATE auctions SET ${column} = ? WHERE id = ?`, [commit, auctionId]);
  saveDb();
}

function setReveal(auctionId, seat, bid, secret) {
  const bidColumn = seat === 'A' ? 'bid_a' : 'bid_b';
  const secretColumn = seat === 'A' ? 'secret_a' : 'secret_b';
  db.run(`UPDATE auctions SET ${bidColumn} = ?, ${secretColumn} = ? WHERE id = ?`, [bid, secret, auctionId]);
  saveDb();
}

function resetCommit(auctionId, seat) {
  const column = seat === 'A' ? 'commit_a' : 'commit_b';
  db.run(`UPDATE auctions SET ${column} = NULL WHERE id = ?`, [auctionId]);
  saveDb();
}

module.exports = {
  initDb,
  createAuction,
  getAuctionBySeatToken,
  getAuctionById,
  setCommit,
  setReveal,
  resetCommit
};
