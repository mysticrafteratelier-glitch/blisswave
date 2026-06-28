// netlify/functions/describe.js
// 🌸 BlissWave — Nombrado de joyería con IA (versión mejorada)
// Requiere la variable de entorno: OPENAI_API_KEY
// Responde: { name, description, category }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let { imageUrl, imageBase64, categories } = body;
    categories = Array.isArray(categories) ? categories.filter(Boolean) : [];

    let imageForApi = imageUrl || imageBase64 || '';
    if (imageBase64 && !imageUrl) {
      imageForApi = imageBase64.startsWith('data:')
        ? imageBase64
        : ('data:image/jpeg;base64,' + imageBase64);
    }
    if (!imageForApi) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Falta imageUrl o imageBase64' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falta OPENAI_API_KEY' }) };
    }

    const catList = categories.length
      ? categories.join(', ')
      : 'Collares, Pulseras, Aretes, Anillos, Dijes, Tobilleras, Sets';

    const systemPrompt = [
      'Eres una catalogadora experta de BISUTERIA ENCHAPADA EN ORO 14K para la tienda boutique femenina BlissWave.',
      'Recibes UNA foto de una sola pieza y devuelves: un nombre comercial corto y PRECISO, una descripcion breve y su categoria.',
      '',
      'REGLAS (siguelas siempre):',
      '1) Identifica el TIPO por su forma real: Anillo, Pulsera, Collar/Cadena, Aretes, Dije/Colgante, Tobillera o Set/Juego.',
      '2) Identifica el MOTIVO principal SOLO si se ve claro: trebol/clover, corazon, flor, mariposa, estrella, ojo turco, infinito, cruz, perla, circones, eslabones, etc.',
      '3) SE LITERAL Y CONSERVADORA. Menciona un animal o figura (elefante, buho, mariposa, etc.) SOLO si es CLARAMENTE eso. Si dudas del motivo, usa un descriptor generico ("Dorado", "Texturizado", "Brillante", "Clasico"). NUNCA inventes una figura.',
      '4) Toma en cuenta color/acabado visible: dorado, plateado, esmalte rojo/azul/negro/verde, piedras blancas/circon, perla.',
      '5) NOMBRE en espanol, elegante, de 2 a 4 palabras, formato "[Tipo] [Motivo] [Detalle]". Sin marcas registradas (NO Van Cleef, NO Cartier, NO Tiffany).',
      '6) DESCRIPCION: una sola frase corta y vendedora en espanol (maximo 16 palabras).',
      '7) CATEGORIA: elige EXACTAMENTE una de esta lista y copiala igual: ' + catList + '.',
      '',
      'Responde UNICAMENTE con JSON valido, sin markdown ni texto extra:',
      '{"name":"...","description":"...","category":"..."}'
    ].join('\n');

    const payload = {
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Nombra esta pieza siguiendo TODAS las reglas. Categorias validas: ' + catList },
            { type: 'image_url', image_url: { url: imageForApi } }
          ]
        }
      ]
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'OpenAI error', detail: errText.slice(0, 300) }) };
    }

    const data = await resp.json();
    let content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    content = content.replace(/```json|```/g, '').trim();

    let parsed = {};
    try { parsed = JSON.parse(content); } catch (e) { parsed = {}; }

    let category = parsed.category || '';
    if (categories.length && category) {
      const exact = categories.find(c => c.toLowerCase() === String(category).toLowerCase());
      if (exact) {
        category = exact;
      } else {
        const partial = categories.find(c =>
          String(category).toLowerCase().includes(c.toLowerCase()) ||
          c.toLowerCase().includes(String(category).toLowerCase())
        );
        category = partial || category;
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        name: (parsed.name || '').toString().trim() || null,
        description: (parsed.description || '').toString().trim() || null,
        category: (category || '').toString().trim() || null
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: (err && err.message) || 'Error interno' }) };
  }
};
