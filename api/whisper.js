const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `input_${Date.now()}.mp4`);
  const audioPath = path.join(tmpDir, `audio_${Date.now()}.mp3`);

  try {
    // Raccoglie il body (multipart con il video)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    // Estrae il file video dal multipart
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);

    let videoBuffer;
    if (boundaryMatch) {
      // Parsing manuale del multipart per estrarre il file
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

    if (!videoBuffer || videoBuffer.length < 1000) {
      // Fallback: usa il body direttamente come video
      videoBuffer = body;
    }

    // Salva il video su disco
    fs.writeFileSync(inputPath, videoBuffer);

    // Controlla se ffmpeg è disponibile e estrai audio
    let audioBuffer;
    try {
      execSync(`ffmpeg -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}" -y 2>/dev/null`, {
        timeout: 60000
      });
      audioBuffer = fs.readFileSync(audioPath);
    } catch (ffmpegErr) {
      // ffmpeg non disponibile: manda il video direttamente a Whisper
      audioBuffer = videoBuffer;
    }

    // Crea il FormData per Whisper
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'it');
    form.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        ...form.getHeaders()
      },
      body: form.getBuffer()
    });

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // Pulizia file temporanei
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}
  }
};

module.exports.config = { api: { bodyParser: false } };
