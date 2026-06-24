// Función segura: recibe la foto de una pieza y devuelve { name, description }
// usando OpenAI (visión). La llave vive en una variable de entorno de Netlify,
// nunca en el código del admin.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Permitir preflight CORS (el admin está en otro dominio)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falta OPENAI_API_KEY' }) };
  }

  let imageUrl, imageBase64;
  try {
    const body = JSON.parse(event.body || '{}');
    imageUrl = body.imageUrl;
    imageBase64 = body.imageBase64;
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!imageUrl && !imageBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Falta la imagen' }) };
  }

  const imageContent = imageUrl
    ? { type: 'image_url', image_url: { url: imageUrl } }
    : { type: 'image_url', image_url: { url: imageBase64 } };

  const prompt = `Eres asistente de una tienda de joyería de oro laminado 14k (BlissWave). Mira la foto de la pieza y responde SOLO un JSON, sin texto extra, con este formato exacto:
{"name":"...","description":"..."}
Reglas:
- "name": un nombre corto y atractivo en español para la pieza (ej. "Anillo Corazón Dorado", "Pulsera Tejido Fino"). Máximo 5 palabras. No inventes marca.
- "description": 2 a 4 frases en español, atractivas para vender, describiendo tipo de pieza, color, piedras/cristales si los hay, estilo y ocasión. Menciona que es oro laminado 14k. No inventes medidas exactas ni precios.`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              imageContent,
            ],
          },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: resp.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || 'Error de OpenAI' }) };
    }

    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = { name: '', description: text };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: parsed.name || '', description: parsed.description || '' }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(err) }) };
  }
};

