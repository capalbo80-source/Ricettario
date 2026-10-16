// Trascrizione audio/video con Groq Whisper
// Groq Whisper accetta: mp4, mp3, wav, webm, m4a, ogg, flac (max 25MB)

const Busboy = require('busboy');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Leggi il file dal multipart con busboy
    const fileBuffer = await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      let chunks = [];
      let found = false;

      bb.on('file', (name, stream) => {
        found = true;
        stream.on('data', d => chunks.push(d));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });

      bb.on('finish', () => {
        if (!found) reject(new Error('Nessun file nel form'));
      });
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fileBuffer || fileBuffer.length < 100) {
      return res.status(400).json({ error: 'File vuoto o troppo piccolo' });
    }

    if (fileBuffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: 'File troppo grande (max 25 MB)' });
    }

    // Costruisci il multipart manualmente per Groq
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.mp4"\r\n` +
      `Content-Type: video/mp4\r\n\r\n`
    );

    const modelField = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-large-v3`
    );

    const langField = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `it`
    );

    const formatField = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `json`
    );

    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

    const body = Buffer.concat([header, fileBuffer, modelField, langField, formatField, footer]);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    });

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
