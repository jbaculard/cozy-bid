const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'auctions.db');
const db = new Database(dbPath);

// Initialize schema
db.exec(`
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

  const stmt = db.prepare(`
    INSERT INTO auctions (id, title, description, item_url, seat_a_token, seat_b_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, title, description || null, itemUrl || null, seatAToken, seatBToken);

  return { id, seatAToken, seatBToken };
}

function getAuctionBySeatToken(auctionId, seatToken) {
  const stmt = db.prepare(`
    SELECT * FROM auctions WHERE id = ? AND (seat_a_token = ? OR seat_b_token = ?)
  `);
  const auction = stmt.get(auctionId, seatToken, seatToken);

  if (!auction) return null;

  const seat = auction.seat_a_token === seatToken ? 'A' : 'B';
  return { auction, seat };
}

function getAuctionById(auctionId) {
  const stmt = db.prepare('SELECT * FROM auctions WHERE id = ?');
  return stmt.get(auctionId);
}

function setCommit(auctionId, seat, commit) {
  const column = seat === 'A' ? 'commit_a' : 'commit_b';
  const stmt = db.prepare(`UPDATE auctions SET ${column} = ? WHERE id = ?`);
  return stmt.run(commit, auctionId);
}

function setReveal(auctionId, seat, bid, secret) {
  const bidColumn = seat === 'A' ? 'bid_a' : 'bid_b';
  const secretColumn = seat === 'A' ? 'secret_a' : 'secret_b';
  const stmt = db.prepare(`UPDATE auctions SET ${bidColumn} = ?, ${secretColumn} = ? WHERE id = ?`);
  return stmt.run(bid, secret, auctionId);
}

function resetCommit(auctionId, seat) {
  const column = seat === 'A' ? 'commit_a' : 'commit_b';
  const stmt = db.prepare(`UPDATE auctions SET ${column} = NULL WHERE id = ?`);
  return stmt.run(auctionId);
}

module.exports = {
  createAuction,
  getAuctionBySeatToken,
  getAuctionById,
  setCommit,
  setReveal,
  resetCommit
};
