// Estrae frame dal video e li analizza con Gemini Flash
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
  const inputPath = path.join(tmpDir, `vid_${Date.now()}.mp4`);
  const framePattern = path.join(tmpDir, `frame_${Date.now()}_%d.jpg`);
  const framePaths = [];

  try {
    // Leggi il video dal body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    // Parsing multipart
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    let videoBuffer = body;

    if (boundaryMatch) {
      const boundary = '--' + boundaryMatch[1];
      const bodyStr = body.toString('binary');
      const parts = bodyStr.split(boundary);
      for (const part of parts) {
        if (part.includes('Content-Disposition') && part.includes('filename')) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const fileData = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));
            videoBuffer = Buffer.from(fileData, 'binary');
            break;
          }
        }
      }
    }

    fs.writeFileSync(inputPath, videoBuffer);

    // Estrai 4 frame distribuiti nel video con ffmpeg
    let frames = [];
    try {
      execSync(
        `ffmpeg -i "${inputPath}" -vf "fps=1/5,scale=512:-1" -frames:v 4 "${framePattern}" -y 2>/dev/null`,
        { timeout: 30000 }
      );
      // Raccogli i frame generati
      for (let i = 1; i <= 4; i++) {
        const fp = framePattern.replace('%d', String(i));
        if (fs.existsSync(fp)) {
          frames.push(fp);
          framePaths.push(fp);
        }
      }
    } catch (e) {
      return res.status(500).json({ error: 'ffmpeg non disponibile per estrazione frame' });
    }

    if (frames.length === 0) {
      return res.status(500).json({ error: 'Nessun frame estratto dal video' });
    }

    // Converti frame in base64
    const imageParts = frames.map(fp => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: fs.readFileSync(fp).toString('base64')
      }
    }));

    // Chiedi a Gemini di descrivere la ricetta dai frame
    const prompt = `Sei un assistente culinario. Analizza questi frame di un video di cucina e descrivi:
1. Il nome del piatto che viene preparato
2. Gli ingredienti che vedi (scritti sullo schermo o visibili fisicamente)
3. I passaggi del procedimento che riesci a leggere o dedurre

Rispondi in italiano. Sii specifico su quantità e ingredienti se visibili. Se non riesci a vedere chiaramente una ricetta, descrivi comunque cosa vedi nel video.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              ...imageParts
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
        }),
        signal: AbortSignal.timeout(30000)
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
