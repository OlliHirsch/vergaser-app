export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key nicht konfiguriert' });

  const { imageB64, mimeType } = req.body || {};
  if (!imageB64 || !mimeType) return res.status(400).json({ error: 'Fehlende Bilddaten' });

  const prompt = `Du bist ein erfahrener 2-Takt-Motorenexperte und analysierst das Bild einer Zündkerze aus einem Piaggio/Minarelli 50cc oder 70cc 2-Takt-Moped mit Dellorto-Vergaser.

Analysiere das Kerzenbild genau. Beurteile insbesondere:
- Farbe und Zustand des Isolators (weißer Keramik-Teil)
- Ablagerungen auf Elektrode und Isolator (Ruß, Öl, Schmelzspuren)
- Allgemeinen Verbrennungszustand

Antworte NUR mit einem JSON-Objekt, kein Text davor oder danach:
{
  "zustand": "optimal" | "zu_fett" | "zu_mager" | "nass_oelig" | "ueberhitzt" | "unklar",
  "diagnose": "Beschreibung was du siehst (2-3 Sätze, auf Deutsch, präzise)",
  "massnahme": "Konkrete Handlungsempfehlung für Dellorto-Vergaser (Düsengröße, Luftschraube etc.)",
  "dringlichkeit": "sofort handeln" | "baldmöglichst" | "beobachten" | "alles ok",
  "bildqualitaet": "gut" | "ausreichend" | "schlecht"
}

Wenn das Bild keine Zündkerze zeigt oder zu unscharf/dunkel ist: zustand="unklar", bildqualitaet="schlecht".`;

  // Erst verfügbare kostenlose Vision-Modelle von OpenRouter abrufen
  let freeVisionModels = [];
  try {
    const modelsResp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (modelsResp.ok) {
      const modelsData = await modelsResp.json();
      freeVisionModels = (modelsData.data || [])
        .filter(m =>
          m.pricing && m.pricing.prompt === '0' &&
          m.architecture && m.architecture.modality && m.architecture.modality.includes('image')
        )
        .map(m => m.id)
        .slice(0, 5); // max 5 versuchen
    }
  } catch (_) {}

  // Fallback-Liste falls API-Abfrage scheitert
  if (freeVisionModels.length === 0) {
    freeVisionModels = [
      'google/gemini-2.0-flash-exp:free',
      'google/gemma-3-27b-it:free',
      'meta-llama/llama-3.2-11b-vision-instruct:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
    ];
  }

  let lastError = 'Kein Modell verfügbar';
  let errors = [];

  for (const model of freeVisionModels) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://scooter-garage.vercel.app',
          'X-Title': 'Scooter Garage'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageB64}` } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = (err.error && (err.error.message || JSON.stringify(err.error))) || 'Fehler ' + response.status;
        errors.push(`${model}: ${msg}`);
        continue;
      }

      const data = await response.json();
      const raw = ((data.choices || [])[0]?.message?.content || '').trim();
      if (!raw) { errors.push(`${model}: Leere Antwort`); continue; }

      const jsonStr = raw.replace(/```json|```/g, '').trim();
      const result = JSON.parse(jsonStr);
      return res.status(200).json(result);

    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }

  return res.status(500).json({ error: errors.join(' | ') || lastError });
}
