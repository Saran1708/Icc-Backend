const express = require('express');
const axios = require('axios');

const router = express.Router();

router.get('/', async (req, res) => {
  const apiSecret = process.env.VDOCIPHER_API_SECRET;

  if (!apiSecret) {
    return res.status(500).json({
      success: false,
      error: 'VDOCIPHER_API_SECRET is not set in environment variables'
    });
  }

  try {
    const response = await axios.post(
      'https://dev.vdocipher.com/api/videos/4a161bd4da3c202e02d7652eb416854f/otp',
      {
        ttl: 300
      },
      {
        headers: {
          'Authorization': `Apisecret ${apiSecret}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error('VdoCipher Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate token',
      details: error.response?.data
    });
  }
});

module.exports = router;