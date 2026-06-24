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

  let imageUrl, imageBase64, category, categories;
  try {
    const body = JSON.parse(event.body || '{}');
    imageUrl = body.imageUrl;
    imageBase64 = body.imageBase64;
    category = (body.category || '').trim();
    categories = Array.isArray(body.categories) ? body.categories.filter(Boolean) : [];
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const imageContent = imageUrl
    ? { type: 'image_url', image_url: { url: imageUrl } }
    : { type: 'image_url', image_url: { url: imageBase64 } };

  if (!imageUrl && !imageBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Falta la imagen' }) };
  }

  let tipoConocido;
  let pideCategoria = '';
  if (category) {
    tipoConocido = `IMPORTANTE: Esta pieza ES un/una "${category}". Esto es un dato CONFIRMADO por la dueña, NO lo cambies ni lo contradigas. El nombre y la descripción DEBEN tratarla como "${category}". Por ejemplo, si la categoría es "Dije", nunca digas "aretes" ni "anillo": es un dije/colgante.`;
    pideCategoria = `- "category": escribe exactamente "${category}".`;
  } else if (categories.length) {
    tipoConocido = `No se indicó la categoría. Mira bien la foto para identificar el tipo de pieza.`;
    pideCategoria = `- "category": elige la que mejor describa la pieza SOLO de esta lista exacta: [${categories.join(', ')}]. Copia el texto EXACTO de la lista (mismas mayúsculas/acentos). Si no estás segura o ninguna encaja bien, deja "category" como cadena vacía "". NO inventes categorías fuera de la lista.`;
  } else {
    tipoConocido = `No se indicó la categoría. Mira bien la foto para identificar el tipo de pieza. Si NO estás totalmente segura del tipo (por ejemplo, podría ser dije, arete o colgante), usa una palabra neutral como "pieza" o "joya" en el nombre, en vez de adivinar y arriesgarte a equivocarte. Es mejor un nombre neutral correcto que uno específico equivocado.`;
    pideCategoria = `- "category": deja "category" como cadena vacía "".`;
  }

  const prompt = `Eres asistente de una tienda de joyería de oro laminado 14k (BlissWave). Mira la foto de la pieza y responde SOLO un JSON, sin texto extra, con este formato exacto:
{"name":"...","description":"...","category":"..."}

${tipoConocido}

Reglas:
- "name": un nombre corto y atractivo en español para la pieza. Máximo 5 palabras. INCLUYE la figura o motivo principal si se ve claramente (por ejemplo: mariposa, corazón, flor, estrella, cruz, infinito, trébol, ojo, luna, serpiente, lazo, hoja, etc.). Ejemplos: "Anillo Mariposa Brillante", "Dije Corazón Cristal", "Aretes Flor Dorados". No inventes marca.
- "description": 2 a 4 frases en español, atractivas para vender, describiendo tipo de pieza, color, piedras/cristales si los hay, estilo y ocasión. Menciona que es oro laminado 14k. No inventes medidas exactas ni precios.
- Las piedras/cristales son zirconias o cristales (NO digas que son diamantes, esmeraldas ni piedras preciosas reales).
${pideCategoria}`;

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
      body: JSON.stringify({ name: parsed.name || '', description: parsed.description || '', category: parsed.category || '' }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(err) }) };
  }
};
