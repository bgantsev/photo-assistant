const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Replicate = require('replicate');
const fetch = require('node-fetch'); // v2

const app = express();
app.use(cors());

// Multer v2 — храним файлы в памяти
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // до 25 МБ на файл
});

// Клиент Replicate
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
if (!process.env.REPLICATE_API_TOKEN) {
  console.warn('⚠️ REPLICATE_API_TOKEN не задан. Перед запуском: export REPLICATE_API_TOKEN="..."');
}

// Стили → промпты
const STYLE_PROMPTS = {
  pencil:           'high-quality pencil sketch, clean lines, realistic shading, subtle paper texture',
  watercolor:       'watercolor painting, soft edges, gentle wash, paper texture, natural gradients',
  oil:              'oil painting, rich brush strokes, impasto, realistic lighting, detailed texture',
  colored_pencils:  'colored pencil drawing, vivid colors, visible pencil strokes, paper grain',
  markers:          'alcohol markers illustration, bold outlines, flat fills, cel shading, comic style',
  photo_real:       'photo-realistic enhancement, crisp details, high dynamic range, natural skin tones'
};

// ⚠️ Здесь нужно заменить на реальный version ID модели SDXL img2img с Replicate
const SDXL_IMG2IMG_VERSION = '<MODEL_VERSION>';

async function waitPrediction(id, intervalMs = 1500, timeoutMs = 120000) {
  const start = Date.now();
  let p = await replicate.predictions.get(id);
  while (p.status === 'starting' || p.status === 'processing') {
    if (Date.now() - start > timeoutMs) throw new Error('Prediction timeout');
    await new Promise(r => setTimeout(r, intervalMs));
    p = await replicate.predictions.get(p.id);
  }
  if (p.status !== 'succeeded') throw new Error(p.error || 'Replicate failed');
  return p;
}

async function sdxlImg2Img(buffer, prompt, strength = 0.6, guidance = 7) {
  const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
  const pred = await replicate.predictions.create({
    version: SDXL_IMG2IMG_VERSION,
    input: {
      image: dataUrl,
      prompt,
      strength,
      guidance_scale: guidance
    }
  });
  const done = await waitPrediction(pred.id);
  const outUrl = Array.isArray(done.output) ? done.output[0] : done.output;
  const resp = await fetch(outUrl);
  const outBuf = await resp.buffer();
  return 'data:image/png;base64,' + outBuf.toString('base64');
}

app.post('/api/transform', upload.array('photos'), async (req, res) => {
  try {
    const style = (req.body.style || 'photo_real');
    const intensity = Math.max(0, Math.min(1, parseFloat(req.body.intensity || '0.7')));

    const strength = 0.3 + intensity * 0.5;
    const guidance = 6 + Math.round(intensity * 4);
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.photo_real;

    const out = [];
    for (const f of (req.files || [])) {
      const dataUrl = await sdxlImg2Img(f.buffer, prompt, strength, guidance);
      out.push({ filename: (f.originalname || 'image') + '.png', dataUrl });
    }
    res.json({ images: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log('🧠 AI server on http://localhost:' + PORT));
