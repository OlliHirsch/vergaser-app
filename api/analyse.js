export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key nicht konfiguriert' });

  try {
    const { imageB64, mimeType } = req.body;
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: imageB64
              }
            },
            { text: prompt }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err.error && err.error.message) || 'Gemini API Fehler ' + response.status;
      return res.status(response.status).json({ error: msg });
    }

    const data = await response.json();
    const raw = (
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text
    ) || '';

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(jsonStr);

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unbekannter Fehler' });
  }
}
