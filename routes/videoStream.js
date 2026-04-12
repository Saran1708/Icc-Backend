// routes/videoStream.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');

const router = express.Router();

const VIDEOS = {
    course: 'course.mp4',
    // module2: 'module2.mp4',
};

// GET /api/video-stream?v=course&token=xxx
router.get('/',

    // ── Step 1: Inject token from query param into header ───────
    (req, res, next) => {
        console.log('🎬 Video stream request received');
        console.log('🔑 Query token:', req.query.token ? 'present' : 'MISSING');
        console.log('🌐 Auth header:', req.headers.authorization ? 'present' : 'missing');

        if (req.query.token && !req.headers.authorization) {
            req.headers.authorization = `Bearer ${req.query.token}`;
            console.log('✅ Token injected into authorization header');
        }

        next();
    },

    // ── Step 2: Authenticate ────────────────────────────────────
    auth,

    // ── Step 3: Stream video ────────────────────────────────────
    (req, res) => {
        console.log('👤 User id:', req.user?.id, '| is_paid:', req.user?.is_paid);

        if (!req.user.is_paid) {
            console.log('❌ Access denied — user not paid');
            return res.status(403).json({ success: false, error: 'Access denied. Please purchase the course.' });
        }

        const videoKey = req.query.v || 'course';
        const videoFile = VIDEOS[videoKey];
        console.log('🎥 Video key:', videoKey, '| File:', videoFile);

        if (!videoFile) {
            console.log('❌ Video key not found');
            return res.status(404).json({ success: false, error: 'Video not found' });
        }

       const videoPath = '/home/' + process.env.HOSTINGER_USER + '/private_videos/' + videoFile;
        console.log('📁 Full video path:', videoPath);

        if (!fs.existsSync(videoPath)) {
            console.log('❌ File does NOT exist at:', videoPath);
            return res.status(404).json({ success: false, error: 'Video file not found on server' });
        }

        console.log('✅ File exists! Streaming...');

        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        console.log('📦 File size:', fileSize, 'bytes');
        console.log('📡 Range header:', range || 'none');

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            console.log(`📤 Serving range: ${start}-${end} (${chunkSize} bytes)`);

            const fileStream = fs.createReadStream(videoPath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });

            fileStream.pipe(res);

        } else {
            console.log('📤 Serving full file');

            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
            });

            fs.createReadStream(videoPath).pipe(res);
        }
    }
);

module.exports = router;