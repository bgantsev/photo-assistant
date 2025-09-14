// ================== server-nano.js ==================
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Replicate = require('replicate');
const fetch = require('node-fetch'); // v2

const app = express();
app.use(cors());

// Multer: храним файлы в памяти
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB/файл
});

// Replicate client
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
if (!process.env.REPLICATE_API_TOKEN) {
  console.warn('⚠️  REPLICATE_API_TOKEN не задан. На Render добавь в Settings → Environment → Variables.');
}

// Стили → промпты
const STYLE_PROMPTS = {
  pencil:           'pencil sketch style, clean lines, realistic shading, subtle paper texture',
  watercolor:       'watercolor painting style, soft edges, gentle wash, paper texture, natural gradients',
  oil:              'oil painting style, rich brush strokes, impasto, realistic lighting, detailed texture',
  colored_pencils:  'colored pencil drawing style, vivid colors, visible pencil strokes, paper grain',
  markers:          'alcohol markers illustration style, bold outlines, flat fills, cel shading, comic look',
  photo_real:       'photo-realistic enhancement, crisp details, natural tones, high dynamic range'
};

// Helpers
function bufferToDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function urlToDataUrl(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = await r.buffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function normalizeOutputs(output) {
  const urls = [];
  const pushUrl = (u) => { if (u && typeof u === 'string') urls.push(u); };

  try {
    // некоторые SDK возвращают объект с .url()
    if (output && typeof output.url === 'function') {
      urls.push(output.url());
    }
  } catch {}

  if (typeof output === 'string') urls.push(output);
  if (Array.isArray(output)) output.forEach(pushUrl);
  if (output && output.output && Array.isArray(output.output)) {
    output.output.forEach(pushUrl);
  }

  return urls;
}

// Health-check (удобно для Render)
app.get('/health', (req, res) => {
  res.json({ ok: true, model: 'google/nano-banana', ts: Date.now() });
});

// Основной эндпоинт
app.post('/api/transform', upload.array('photos'), async (req, res) => {
  try {
    const body = req.body || {};
    const style = body.style || 'photo_real';
    const userPrompt = (body.prompt || '').trim();
    const prompt = userPrompt || (STYLE_PROMPTS[style] || STYLE_PROMPTS.photo_real);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Нет файлов (ожидалось поле "photos" в multipart/form-data)' });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'REPLICATE_API_TOKEN не задан на сервере' });
    }

    // Готовим входы (data:URL для nano-banana)
    const image_input = req.files.map(f => bufferToDataUrl(f.buffer, f.mimetype || 'image/png'));

    // Вызов модели
    const output = await replicate.run("google/nano-banana", {
      input: { prompt, image_input }
    });

    const urls = await normalizeOutputs(output);
    if (!urls.length) {
      return res.status(502).json({ error: 'Пустой ответ от модели' });
    }

    // Скачиваем по URL и конвертируем в dataURL для фронта
    const images = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const dataUrl = await urlToDataUrl(urls[i]);
        images.push({
          filename: (req.files?.[i]?.originalname || `image-${i + 1}`) + '.png',
          dataUrl
        });
      } catch (e) {
        console.error('fetch image error:', e);
      }
    }

    if (!images.length) {
      return res.status(502).json({ error: 'Не удалось получить изображения из ответа модели' });
    }

    return res.json({ images });
  } catch (err) {
    console.error('transform error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Запуск
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('🍌 nano-banana server on http://localhost:' + PORT);
});
