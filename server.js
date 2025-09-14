const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sharp = require('sharp');

const app = express();
app.use(cors());
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // up to 25 MB per file

async function transformImage(buffer, style, intensity) {
  let img = sharp(buffer).ensureAlpha();
  const meta = await img.metadata();
  const maxDim = 2000;
  let w = meta.width || 0, h = meta.height || 0;
  if (Math.max(w, h) > maxDim) {
    const scale = maxDim / Math.max(w, h);
    img = img.resize(Math.round(w * scale), Math.round(h * scale), { fit: 'inside' });
  }

  switch (style) {
    case 'pencil':
      img = img.grayscale().linear(1 + intensity * 0.2, -20 * intensity);
      break;
    case 'watercolor':
      img = img.modulate({ saturation: 0.8 - intensity * 0.4 }).blur(0.8 * intensity + 0.3);
      break;
    case 'oil':
      img = img.modulate({ brightness: 1 + 0.05 * intensity, saturation: 0.9 }).sharpen();
      break;
    case 'colored_pencils':
      img = img.modulate({ saturation: 1 + 0.3 * intensity, brightness: 1 + 0.05 * intensity });
      break;
    case 'markers':
      img = img.toColourspace('srgb');
      break;
    case 'photo_real':
      img = img.sharpen().modulate({ saturation: 1 + 0.1 * intensity, brightness: 1 + 0.05 * intensity });
      break;
  }

  const buf = await img.png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

app.post('/api/transform', upload.array('photos'), async (req, res) => {
  try {
    const style = req.body.style || 'pencil';
    const intensity = Math.max(0, Math.min(1, parseFloat(req.body.intensity || '0.7')));
    const out = [];

    for (const f of req.files || []) {
      const dataUrl = await transformImage(f.buffer, style, intensity);
      out.push({ filename: (f.originalname || 'image') + '.png', dataUrl });
    }

    res.json({ images: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server listening on http://localhost:' + PORT));
