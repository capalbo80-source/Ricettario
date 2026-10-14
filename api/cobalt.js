// Proxy per cobalt API - scarica video da link social
// Usa istanze pubbliche cobalt che non richiedono auth
const COBALT_INSTANCES = [
  'https://cobalt.api.buldakov.ru',
  'https://co.wuk.sh',
  'https://cobalt.downloadthis.online',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') body = JSON.parse(body);
  const { url } = body;
  if (!url) return res.status(400).json({ error: 'url mancante' });

  // Prova ogni istanza finché una funziona
  let lastError = null;
  for (const instance of COBALT_INSTANCES) {
    try {
      const response = await fetch(`${instance}/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          downloadMode: 'auto',
          videoQuality: '720',
          filenameStyle: 'basic'
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        lastError = `${instance}: HTTP ${response.status}`;
        continue;
      }

      const data = await response.json();

      if (data.status === 'error') {
        lastError = data.error?.code || 'errore cobalt';
        continue;
      }

      if (data.status === 'tunnel' || data.status === 'redirect') {
        return res.status(200).json({ videoUrl: data.url, filename: data.filename });
      }

      if (data.status === 'picker' && data.picker?.length > 0) {
        return res.status(200).json({ videoUrl: data.picker[0].url, filename: data.filename });
      }

      lastError = `Risposta inattesa: ${data.status}`;
    } catch (err) {
      lastError = `${instance}: ${err.message}`;
    }
  }

  res.status(502).json({ error: lastError || 'Nessuna istanza disponibile' });
};
