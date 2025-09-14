const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Replicate = require('replicate');
const fetch = require('node-fetch'); // v2

const app = express();
app.use(cors());

// Multer v2 — файлы в памяти
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB/файл
});

// Replicate client (токен из переменной окружения)
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
if (!process.env.REPLICATE_API_TOKEN) {
  console.warn('⚠️  REPLICATE_API_TOKEN не задан. Перед запуском: export REPLICATE_API_TOKEN="..."');
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

// Универсальная нормализация вывода nano-banana
async function normalizeOutputs(output) {
  const urls = [];
  const pushUrl = (u) => { if (u && typeof u === 'string') urls.push(u); };
  try { if (output && typeof output.url === 'function') urls.push(output.url()); } catch {}
  if (typeof output === 'string') urls.push(output);
  if (Array.isArray(output)) output.forEach(pushUrl);
  return urls;
}

// Скачиваем URL -> dataURL
async function urlToDataUrl(u) {
  const r = await fetch(u);
  const buf = await r.buffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

app.post('/api/transform', upload.array('photos'), async (req, res) => {
  try {
    const style = (req.body.style || 'photo_real');
    const userPrompt = (req.body.prompt || '').trim();
    const prompt = userPrompt || (STYLE_PROMPTS[style] || STYLE_PROMPTS.photo_real);

    // Собираем картинки
    const image_input = [];
    for (const f of (req.files || [])) {
      const dataUrl = 'data:' + (f.mimetype || 'image/png') + ';base64,' + f.buffer.toString('base64');
      image_input.push(dataUrl);
    }
    if (!image_input.length) return res.status(400).json({ error: 'Нет файлов (ожидались "photos")' });

    // Вызов модели
    const output = await replicate.run("google/nano-banana", {
      input: { prompt, image_input }
    });

    const urls = await normalizeOutputs(output);
    if (!urls.length) return res.status(500).json({ error: 'Пустой ответ от модели' });

    const images = [];
    for (let i = 0; i < urls.length; i++) {
      images.push({
        filename: (req.files?.[i]?.originalname || `image-${i+1}`) + '.png',
        dataUrl: await urlToDataUrl(urls[i])
      });
    }

    res.json({ images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Порт 3001, чтобы не конфликтовать с server.js
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log('🍌 nano-banana server on http://localhost:' + PORT));
