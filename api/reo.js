// Kupu AI · Kōrero o te Rā — server function (Vercel)
// Keys live in Vercel → Settings → Environment Variables:
//   ANTHROPIC_API_KEY, ELEVENLABS_API_KEY  (required)
//   ELEVENLABS_VOICE_ID, CLAUDE_MODEL, STT_MODEL, TTS_MODEL, REO_LANG (optional)

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const STT_MODEL = process.env.STT_MODEL || 'scribe_v2';
const TTS_MODELS = [process.env.TTS_MODEL, 'eleven_v3', 'eleven_multilingual_v2'].filter(Boolean);
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const LANG = process.env.REO_LANG || 'mi';
const EL = 'https://api.elevenlabs.io/v1';

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, chat: !!process.env.ANTHROPIC_API_KEY, voice: !!process.env.ELEVENLABS_API_KEY });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  try {
    if (body.action === 'chat') return await chat(body, res);
    if (body.action === 'stt') return await stt(body, res);
    if (body.action === 'tts') return await tts(body, res);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};

async function chat({ system, messages, max_tokens }, res) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel.' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: max_tokens || 1500, system, messages }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: (data.error && data.error.message) || 'Claude error' });
  return res.status(200).json({ text: (data.content || []).map(c => c.text || '').join('') });
}

async function stt({ audio, mime }, res) {
  if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not set in Vercel.' });
  const bytes = Buffer.from(audio, 'base64');
  const send = async (withLang) => {
    const form = new FormData();
    form.append('model_id', STT_MODEL);
    if (withLang) form.append('language_code', LANG);
    form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), 'reo.' + ((mime || '').includes('mp4') ? 'mp4' : 'webm'));
    return fetch(EL + '/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form });
  };
  let r = await send(true);
  if (r.status === 400 || r.status === 422) r = await send(false);
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: (data.detail && (data.detail.message || JSON.stringify(data.detail))) || 'Transcription error' });
  return res.status(200).json({ text: (data.text || '').trim(), language: data.language_code });
}

async function tts({ text }, res) {
  if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not set in Vercel.' });
  let last = '';
  for (const model of TTS_MODELS) {
    for (const withLang of [true, false]) {
      const payload = { text, model_id: model };
      if (withLang) payload.language_code = LANG;
      const r = await fetch(EL + '/text-to-speech/' + VOICE + '?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('content-type', 'audio/mpeg');
        res.setHeader('x-tts-model', model);
        return res.status(200).send(buf);
      }
      last = await r.text();
      if (r.status === 401 || r.status === 429) return res.status(r.status).json({ error: last });
    }
  }
  return res.status(500).json({ error: 'Voice error: ' + last.slice(0, 300) });
}
