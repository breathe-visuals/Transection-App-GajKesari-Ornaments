const DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbys2KMXTMKebLqn4yQ1dWYhnX2jmdQgSJM6em6znyd5/dev';
const TIMEOUT_MS = 30000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(upstream.ok ? 200 : 502).send(text || '{"result":{"success":false,"message":"Empty backend response"}}');
  } catch (err) {
    const message = err && err.name === 'AbortError' ? 'Backend request timed out' : (err && err.message) || 'Backend request failed';
    return res.status(502).json({ result: { success: false, message } });
  } finally {
    clearTimeout(timer);
  }
};
