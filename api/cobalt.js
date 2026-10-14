// Proxy per fastsaver.io API - scarica video da link social
// Documentazione: https://fastsaverapi.com/docs
// Chiave API da impostare in Vercel come FASTSAVER_API_KEY

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.FASTSAVER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FASTSAVER_API_KEY non configurata' });

  let body = req.body;
  if (typeof body === 'string') body = JSON.parse(body);
  const { url } = body;
  if (!url) return res.status(400).json({ error: 'url mancante' });

  try {
    const response = await fetch(
      `https://api.fastsaver.io/v1/fetch?url=${encodeURIComponent(url)}`,
      {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(20000)
      }
    );

    const data = await response.json();

    if (!data.ok) {
      return res.status(502).json({ error: data.message || 'Errore API fastsaver' });
    }

    // Risposta singola (video/reel)
    if (data.download_url) {
      return res.status(200).json({ videoUrl: data.download_url, filename: data.filename || 'video.mp4' });
    }

    // Album/carosello — prendi il primo video
    if (data.items && data.items.length > 0) {
      const videoItem = data.items.find(i => i.type === 'video') || data.items[0];
      return res.status(200).json({ videoUrl: videoItem.download_url, filename: videoItem.filename || 'video.mp4' });
    }

    return res.status(502).json({ error: 'Nessun video trovato nella risposta' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
