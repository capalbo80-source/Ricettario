// Analisi frame video con Gemini Flash Vision
// Estrae frame con ffmpeg se disponibile, altrimenti manda il video direttamente

const Busboy = require('busboy');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY non configurata' });

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const inputPath = path.join(tmpDir, `vid_${ts}.mp4`);
  const framePaths = [];

  try {
    // Leggi il file con busboy
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
      bb.on('finish', () => { if (!found) reject(new Error('Nessun file')); });
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fileBuffer || fileBuffer.length < 100) {
      return res.status(400).json({ error: 'File vuoto' });
    }

    fs.writeFileSync(inputPath, fileBuffer);

    // Prova a estrarre frame con ffmpeg
    let imageParts = [];
    try {
      // Estrai 4 frame: a 2s, 5s, 10s, 15s dal video
      const times = [2, 5, 10, 15];
      for (const t of times) {
        const framePath = path.join(tmpDir, `frame_${ts}_${t}.jpg`);
        try {
          execSync(
            `ffmpeg -ss ${t} -i "${inputPath}" -vframes 1 -q:v 3 -vf "scale=512:-1" "${framePath}" -y 2>/dev/null`,
            { timeout: 10000 }
          );
          if (fs.existsSync(framePath) && fs.statSync(framePath).size > 100) {
            framePaths.push(framePath);
            imageParts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: fs.readFileSync(framePath).toString('base64')
              }
            });
          }
        } catch {}
      }
    } catch {}

    // Se nessun frame estratto, manda il primo secondo come fallback
    if (imageParts.length === 0) {
      try {
        const framePath = path.join(tmpDir, `frame_${ts}_0.jpg`);
        execSync(
          `ffmpeg -i "${inputPath}" -vframes 1 -q:v 3 -vf "scale=512:-1" "${framePath}" -y 2>/dev/null`,
          { timeout: 10000 }
        );
        if (fs.existsSync(framePath)) {
          framePaths.push(framePath);
          imageParts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: fs.readFileSync(framePath).toString('base64')
            }
          });
        }
      } catch {}
    }

    if (imageParts.length === 0) {
      return res.status(200).json({ description: '' });
    }

    // Chiedi a Gemini di leggere la ricetta dai frame
    const prompt = `Sei un assistente culinario. Analizza questi frame di un video di cucina e descrivi in italiano:
- Il nome del piatto
- Tutti gli ingredienti visibili (scritti sullo schermo o fisicamente presenti)
- Le quantità se visibili
- I passaggi del procedimento leggibili sullo schermo

Sii specifico. Se vedi testo scritto nel video, trascrivilo esattamente.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...imageParts] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
        }),
        signal: AbortSignal.timeout(25000)
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(geminiData.error.message);

    const description = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.status(200).json({ description });

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    framePaths.forEach(fp => { try { fs.unlinkSync(fp); } catch {} });
  }
};

module.exports.config = { api: { bodyParser: false } };
