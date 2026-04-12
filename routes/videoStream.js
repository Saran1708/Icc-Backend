// routes/videoStream.js
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const auth    = require('../middleware/auth');

const router = express.Router();

// Map video keys to actual filenames
// Add more videos here as you add modules
const VIDEOS = {
  course: 'course.mp4',   // /api/video-stream?v=course
  // module2: 'module2.mp4',
  // module3: 'module3.mp4',
};

// GET /api/video-stream?v=course
router.get('/', auth, (req, res) => {

  // ── Check user is paid ──────────────────────────────────────
  if (!req.user.is_paid) {
    return res.status(403).json({ success: false, error: 'Access denied. Please purchase the course.' });
  }

  // ── Get video key from query param ─────────────────────────
  const videoKey  = req.query.v || 'course';
  const videoFile = VIDEOS[videoKey];

  if (!videoFile) {
    return res.status(404).json({ success: false, error: 'Video not found' });
  }

  // ── Build path to private_videos folder ────────────────────
  // This folder is OUTSIDE public_html — not directly accessible
  const videoPath = path.join('/home', process.env.HOSTINGER_USER, 'private_videos', videoFile);

  // ── Check file exists ───────────────────────────────────────
  if (!fs.existsSync(videoPath)) {
    console.error('Video file not found at:', videoPath);
    return res.status(404).json({ success: false, error: 'Video file not found on server' });
  }

  const stat     = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range    = req.headers.range;

  if (range) {
    // ── Range request (seeking/scrubbing support) ─────────────
    const parts  = range.replace(/bytes=/, '').split('-');
    const start  = parseInt(parts[0], 10);
    const end    = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const fileStream = fs.createReadStream(videoPath, { start, end });

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   'video/mp4',
    });

    fileStream.pipe(res);
  } else {
    // ── Full file request ─────────────────────────────────────
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   'video/mp4',
      'Accept-Ranges':  'bytes',
    });

    fs.createReadStream(videoPath).pipe(res);
  }
});

module.exports = router;