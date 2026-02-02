const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database before handling requests
let dbReady = false;
db.initDb().then(() => {
  dbReady = true;
  console.log('Database initialized');
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Middleware to ensure DB is ready
app.use((req, res, next) => {
  if (!dbReady && req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Database initializing, please retry' });
  }
  next();
});

// Rate limiting for commit/reveal endpoints
const commitRevealLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: 'Too many requests, please try again later' }
});

// Rate limiting for auction creation
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many auctions created, please try again later' }
});

// Compute SHA-256 hash
function computeHash(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Validate bid: number > 0, <= 100000, max 2 decimals
function validateBid(bid) {
  if (typeof bid !== 'number' && typeof bid !== 'string') return false;
  const num = parseFloat(bid);
  if (isNaN(num) || num <= 0 || num > 100000) return false;
  // Check max 2 decimals
  const parts = String(bid).split('.');
  if (parts.length > 1 && parts[1].length > 2) return false;
  return true;
}

// API: Create auction
app.post('/api/auction', createLimiter, (req, res) => {
  const { title, description, itemUrl } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'Title is required' });
  }

  if (title.length > 200) {
    return res.status(400).json({ error: 'Title too long (max 200 chars)' });
  }

  try {
    const { id, seatAToken, seatBToken } = db.createAuction(
      title.trim(),
      description?.trim(),
      itemUrl?.trim()
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      auctionId: id,
      seatALink: `${baseUrl}/a/${id}/${seatAToken}`,
      seatBLink: `${baseUrl}/a/${id}/${seatBToken}`
    });
  } catch (err) {
    console.error('Error creating auction:', err.message);
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

// API: Get auction status (with optional seat identification via query param)
app.get('/api/auction/:auctionId/status', (req, res) => {
  const { auctionId } = req.params;
  const { seatToken } = req.query;
  const auction = db.getAuctionById(auctionId);

  if (!auction) {
    return res.status(404).json({ error: 'Auction not found' });
  }

  const hasCommitA = !!auction.commit_a;
  const hasCommitB = !!auction.commit_b;
  const hasRevealA = auction.bid_a !== null;
  const hasRevealB = auction.bid_b !== null;

  let phase;
  if (hasRevealA && hasRevealB) {
    phase = 'revealed';
  } else if (hasCommitA && hasCommitB) {
    phase = 'reveal';
  } else {
    phase = 'commit';
  }

  const response = {
    phase,
    hasCommitA,
    hasCommitB,
    hasRevealA,
    hasRevealB,
    title: auction.title,
    description: auction.description,
    itemUrl: auction.item_url
  };

  // If seatToken provided, identify which seat it belongs to
  if (seatToken) {
    if (auction.seat_a_token === seatToken) {
      response.mySeat = 'A';
    } else if (auction.seat_b_token === seatToken) {
      response.mySeat = 'B';
    }
  }

  // Only include reveals after both are done
  if (hasRevealA && hasRevealB) {
    response.revealed = true;
  }

  res.json(response);
});

// API: Submit commit
app.post('/api/auction/:auctionId/commit', commitRevealLimiter, (req, res) => {
  const { auctionId } = req.params;
  const { seatToken, commit } = req.body;

  if (!seatToken || !commit) {
    return res.status(400).json({ error: 'seatToken and commit are required' });
  }

  // Validate commit format (64 hex chars)
  if (!/^[a-f0-9]{64}$/.test(commit)) {
    return res.status(400).json({ error: 'Invalid commit format' });
  }

  const result = db.getAuctionBySeatToken(auctionId, seatToken);
  if (!result) {
    return res.status(404).json({ error: 'Auction not found or invalid token' });
  }

  const { auction, seat } = result;
  const existingCommit = seat === 'A' ? auction.commit_a : auction.commit_b;

  if (existingCommit) {
    return res.status(400).json({ error: 'Commit already submitted' });
  }

  db.setCommit(auctionId, seat, commit);
  res.json({ ok: true });
});

// API: Reset commit (only if other seat hasn't committed)
app.post('/api/auction/:auctionId/reset-commit', commitRevealLimiter, (req, res) => {
  const { auctionId } = req.params;
  const { seatToken } = req.body;

  if (!seatToken) {
    return res.status(400).json({ error: 'seatToken is required' });
  }

  const result = db.getAuctionBySeatToken(auctionId, seatToken);
  if (!result) {
    return res.status(404).json({ error: 'Auction not found or invalid token' });
  }

  const { auction, seat } = result;
  const otherCommit = seat === 'A' ? auction.commit_b : auction.commit_a;

  if (otherCommit) {
    return res.status(400).json({ error: 'Cannot reset: other party has already committed' });
  }

  db.resetCommit(auctionId, seat);
  res.json({ ok: true });
});

// API: Submit reveal
app.post('/api/auction/:auctionId/reveal', commitRevealLimiter, (req, res) => {
  const { auctionId } = req.params;
  const { seatToken, bid, secret } = req.body;

  if (!seatToken || bid === undefined || !secret) {
    return res.status(400).json({ error: 'seatToken, bid, and secret are required' });
  }

  if (!validateBid(bid)) {
    return res.status(400).json({ error: 'Invalid bid: must be > 0, <= 100000, max 2 decimals' });
  }

  const result = db.getAuctionBySeatToken(auctionId, seatToken);
  if (!result) {
    return res.status(404).json({ error: 'Auction not found or invalid token' });
  }

  const { auction, seat } = result;

  // Check both commits exist
  if (!auction.commit_a || !auction.commit_b) {
    return res.status(400).json({ error: 'Both parties must commit before reveal' });
  }

  // Check not already revealed
  const existingBid = seat === 'A' ? auction.bid_a : auction.bid_b;
  if (existingBid !== null) {
    return res.status(400).json({ error: 'Already revealed' });
  }

  // Verify hash
  const bidStr = parseFloat(bid).toFixed(2);
  const payload = `${bidStr}|${secret}|${auctionId}|${seat}`;
  const computedHash = computeHash(payload);
  const storedCommit = seat === 'A' ? auction.commit_a : auction.commit_b;

  if (computedHash !== storedCommit) {
    return res.status(400).json({ error: 'Hash mismatch: bid or secret does not match commit' });
  }

  // Store reveal (NOTE: we store secret for verification audit, but never return it to other party)
  db.setReveal(auctionId, seat, parseFloat(bidStr), secret);
  res.json({ ok: true });
});

// API: Get result (only after both reveals)
app.get('/api/auction/:auctionId/result', (req, res) => {
  const { auctionId } = req.params;
  const auction = db.getAuctionById(auctionId);

  if (!auction) {
    return res.status(404).json({ error: 'Auction not found' });
  }

  // Only return results if both reveals are complete
  if (auction.bid_a === null || auction.bid_b === null) {
    return res.json({ revealed: false });
  }

  const bidA = auction.bid_a;
  const bidB = auction.bid_b;

  let winner, loser, winnerBid, loserBid;
  if (bidA > bidB) {
    winner = 'A';
    loser = 'B';
    winnerBid = bidA;
    loserBid = bidB;
  } else if (bidB > bidA) {
    winner = 'B';
    loser = 'A';
    winnerBid = bidB;
    loserBid = bidA;
  } else {
    winner = 'TIE';
    winnerBid = bidA;
    loserBid = bidB;
  }

  res.json({
    revealed: true,
    title: auction.title,
    description: auction.description,
    itemUrl: auction.item_url,
    bidA: bidA.toFixed(2),
    bidB: bidB.toFixed(2),
    winner,
    paymentAmount: winner !== 'TIE' ? winnerBid.toFixed(2) : null
  });
});

// Serve participant page
app.get('/a/:auctionId/:seatToken', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'participant.html'));
});

// Serve results page
app.get('/r/:auctionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

// Serve home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sealed-bid auction server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to create an auction`);
});
