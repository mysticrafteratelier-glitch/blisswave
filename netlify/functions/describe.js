// netlify/functions/describe.js
// 🌸 BlissWave — Nombrado de joyería con IA (Gemini v2)
// Requiere la variable de entorno: GEMINI_API_KEY
// Responde: { name, description, category }
// GET = modo diagnóstico (abrir en Safari para verificar)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const GEMINI_MODEL = 'gemini-2.5-flash';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // ── MODO DIAGNÓSTICO: abrir la URL en Safari ──
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        version: 'gemini-v2',
        modelo: GEMINI_MODEL,
        tieneKey: !!process.env.GEMINI_API_KEY
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let { imageUrl, imageBase64, categories, category } = body;
    categories = Array.isArray(categories) ? categories.filter(Boolean) : [];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falta GEMINI_API_KEY en Netlify' }) };
    }

    // ── Conseguir la imagen en base64 (Gemini la necesita así) ──
    let mimeType = 'image/jpeg';
    let dataB64 = '';

    if (imageBase64) {
      if (imageBase64.startsWith('data:')) {
        const m = imageBase64.match(/^data:([^;]+);base64,(.+)$/s);
        if (m) { mimeType = m[1]; dataB64 = m[2]; }
        else { dataB64 = imageBase64.split(',').pop() || ''; }
      } else {
        dataB64 = imageBase64;
      }
    } else if (imageUrl) {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No pude descargar la foto (' + imgResp.status + ')' }) };
      }
      const ct = imgResp.headers.get('content-type');
      if (ct && ct.startsWith('image/')) mimeType = ct.split(';')[0];
      const buf = Buffer.from(await imgResp.arrayBuffer());
      dataB64 = buf.toString('base64');
    }

    if (!dataB64) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Falta la foto (imageUrl o imageBase64)' }) };
    }

    const catList = categories.length
      ? categories.join(', ')
      : 'Collares, Pulseras, Aretes, Anillos, Dijes, Tobilleras, Sets';

    const promptLines = [
      'Eres una catalogadora experta de BISUTERIA ENCHAPADA EN ORO 14K para la tienda BlissWave Collection (Miami, clientas latinas).',
      'Recibes UNA foto de una sola pieza y devuelves un nombre comercial corto y una descripcion de venta.',
      '',
      'REGLAS DEL NOMBRE:',
      '- En espanol, 2 a 4 palabras, femenino y elegante. Ej: "Collar Espiga Dorada", "Anillo Corazon Brillante".',
      '- Empieza con el tipo de pieza (Collar, Pulsera, Aretes, Anillo, Dije, Tobillera, Set, Cadena).',
      '- NO uses la palabra "oro solido" ni marcas. NO inventes piedras que no se ven.',
      '',
      'REGLAS DE LA DESCRIPCION:',
      '- 1 a 2 frases en espanol, tono calido de venta por WhatsApp, menciona "oro laminado 14k".',
      '- Maximo 220 caracteres. Sin emojis.',
      '',
      'CATEGORIA:',
      category
        ? ('- La duena ya definio la categoria: "' + category + '". Usala tal cual en el campo category.')
        : ('- Elige UNA de esta lista exacta: ' + catList + '.'),
      '',
      'FORMATO DE RESPUESTA:',
      'Responde SOLO un objeto JSON valido, sin markdown, sin ```:',
      '{"name":"...","description":"...","category":"..."}'
    ].join('\n');

    // ── Llamar a Gemini ──
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptLines },
            { inline_data: { mime_type: mimeType, data: dataB64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : ('Gemini respondio ' + resp.status);
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Gemini: ' + msg }) };
    }

    let text = '';
    try {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      text = parts.map(p => p.text || '').join('');
    } catch (e) { text = ''; }

    if (!text) {
      const reason = (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || 'sin texto';
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Gemini no devolvio texto (' + reason + ')' }) };
    }

    // Limpiar por si acaso viene con ```json
    text = text.replace(/```json|```/g, '').trim();

    let out;
    try {
      out = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { out = JSON.parse(m[0]); } catch (e2) { out = null; } }
    }

    if (!out || !out.name) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'La IA no dio un nombre valido — intenta de nuevo' }) };
    }

    const result = {
      name: String(out.name).trim(),
      description: String(out.description || '').trim(),
      category: String(out.category || category || '').trim()
    };

    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || 'Error inesperado' }) };
  }
};
