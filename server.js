const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');

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
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 100 // Max 100 files at once
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new multer.MulterError('INVALID_FILE_TYPE', file.originalname));
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
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  const userId = req.cookies.userId || uuidv4();
  
  sessions[sessionId] = {
    photos: [],
    votes: {},
    createdAt: new Date().toISOString(),
    userId: userId,
    name: req.body.name || `Project ${new Date().toLocaleDateString()}`
  };
  
  // Set userId cookie if not already set
  if (!req.cookies.userId) {
    res.cookie('userId', userId, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true,
      sameSite: 'lax'
    });
  }
  
  saveSession(sessionId);
  res.json({ sessionId, userId });
});

// Custom error handling middleware for uploads
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large',
        details: `File size exceeds 10MB limit`,
        field: err.field
      });
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Too many files',
        details: 'Maximum 100 files allowed at once'
      });
    } else if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ 
        error: 'Invalid file type',
        details: `File "${err.field}" is not a supported image format. Allowed formats: JPEG, JPG, PNG, GIF, WEBP`,
        field: err.field
      });
    }
  }
  next(err);
};

app.post('/api/upload/:sessionId', (req, res, next) => {
  const { sessionId } = req.params;
  
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  upload.array('photos', 100)(req, res, (err) => {
    if (err) {
      return handleUploadErrors(err, req, res, next);
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No files uploaded',
        details: 'Please select at least one image to upload'
      });
    }
    
    const uploadedFiles = req.files.map(file => ({
      id: uuidv4(),
      filename: file.filename,
      originalName: file.originalname,
      path: `/uploads/${file.filename}`,
      size: file.size
    }));
    
    sessions[sessionId].photos.push(...uploadedFiles);
    saveSession(sessionId);
    res.json({ 
      success: true,
      files: uploadedFiles,
      message: `Successfully uploaded ${uploadedFiles.length} image${uploadedFiles.length > 1 ? 's' : ''}`
    });
  });
});

app.get('/vote/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

app.get('/results/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'results.html'));
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

// API endpoint to get user's projects
app.get('/api/user/projects', (req, res) => {
  const userId = req.cookies.userId;
  
  if (!userId) {
    return res.json({ projects: [] });
  }
  
  const userProjects = Object.keys(sessions)
    .filter(sessionId => sessions[sessionId].userId === userId)
    .map(sessionId => ({
      id: sessionId,
      name: sessions[sessionId].name,
      createdAt: sessions[sessionId].createdAt,
      photoCount: sessions[sessionId].photos.length,
      voteCount: Object.keys(sessions[sessionId].votes).reduce((total, photoId) => {
        const votes = sessions[sessionId].votes[photoId];
        return total + votes.upvotes.length + votes.downvotes.length;
      }, 0)
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({ projects: userProjects, userId });
});

// API endpoint to update project name
app.put('/api/project/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;
  
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  if (name && name.trim()) {
    sessions[sessionId].name = name.trim();
    saveSession(sessionId);
  }
  
  res.json({ success: true, name: sessions[sessionId].name });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});