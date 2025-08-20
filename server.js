const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Create sessions directory if it doesn't exist
const sessionsDir = 'sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  }
});

let sessions = {};

// Helper functions for session persistence
function saveSession(sessionId) {
  const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify(sessions[sessionId], null, 2));
}

function loadSession(sessionId) {
  const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
  if (fs.existsSync(sessionPath)) {
    const data = fs.readFileSync(sessionPath, 'utf8');
    sessions[sessionId] = JSON.parse(data);
    return true;
  }
  return false;
}

// Load all existing sessions on startup
function loadAllSessions() {
  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        loadSession(sessionId);
      }
    });
    console.log(`Loaded ${Object.keys(sessions).length} existing sessions`);
  }
}

// Load sessions on startup
loadAllSessions();

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  sessions[sessionId] = {
    photos: [],
    votes: {},
    createdAt: new Date().toISOString()
  };
  saveSession(sessionId);
  res.json({ sessionId });
});

app.post('/api/upload/:sessionId', upload.array('photos', 100), (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const uploadedFiles = req.files.map(file => ({
    id: uuidv4(),
    filename: file.filename,
    originalName: file.originalname,
    path: `/uploads/${file.filename}`
  }));
  
  sessions[sessionId].photos.push(...uploadedFiles);
  saveSession(sessionId);
  res.json({ files: uploadedFiles });
});

app.get('/vote/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  // Try to load from disk if not in memory
  if (!sessions[sessionId]) {
    if (!loadSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }
  }
  
  res.json(sessions[sessionId]);
});

app.post('/api/vote/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { photoId, vote, voterId } = req.body;
  
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (!sessions[sessionId].votes[photoId]) {
    sessions[sessionId].votes[photoId] = { upvotes: [], downvotes: [] };
  }
  
  const photoVotes = sessions[sessionId].votes[photoId];
  
  photoVotes.upvotes = photoVotes.upvotes.filter(id => id !== voterId);
  photoVotes.downvotes = photoVotes.downvotes.filter(id => id !== voterId);
  
  if (vote === 'up') {
    photoVotes.upvotes.push(voterId);
  } else if (vote === 'down') {
    photoVotes.downvotes.push(voterId);
  }
  
  saveSession(sessionId);
  res.json({ success: true, votes: photoVotes });
});

app.get('/api/results/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  // Try to load from disk if not in memory
  if (!sessions[sessionId]) {
    if (!loadSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }
  }
  
  const results = sessions[sessionId].photos.map(photo => {
    const votes = sessions[sessionId].votes[photo.id] || { upvotes: [], downvotes: [] };
    return {
      ...photo,
      upvotes: votes.upvotes.length,
      downvotes: votes.downvotes.length,
      score: votes.upvotes.length - votes.downvotes.length
    };
  }).sort((a, b) => b.score - a.score);
  
  res.json(results);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});