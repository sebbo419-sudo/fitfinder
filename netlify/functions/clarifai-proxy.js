// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch;

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;

    // 1️⃣ Kald Clarifai for at finde tøjet
    const clarifaiResp = await fetch("https://api.clarifai.com/v2/models/apparel-detection/outputs", {
      method: "POST",
      headers: {
        "Authorization": `Key ${clarifaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const clarifaiData = await clarifaiResp.json();
    const concepts = clarifaiData.outputs?.[0]?.data?.concepts || [];
    const best = concepts.sort((a, b) => b.value - a.value)[0];
    const apparel = best?.name || "tøj";

    // 2️⃣ Prøv at hente en beskrivelse via Hugging Face’s base64 API
    const base64 = body.inputs?.[0]?.data?.image?.base64;
    let captionEn = null;

    if (base64) {
      const hfResp = await fetch("https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: { image: base64 }
        })
      });

      if (hfResp.ok) {
        const hfData = await hfResp.json();
        captionEn =
          hfData?.[0]?.generated_text ||
          hfData?.generated_text ||
          null;
      }
    }

    // 3️⃣ Oversæt og pift beskrivelsen op
    const finalDescription = await buildDescription(captionEn, apparel);

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ apparel, description: finalDescription })
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fejl i Clarifai-proxyen", details: err.message })
    };
  }
};

// 🧠 Funktion til at bygge en dansk, pæn beskrivelse
async function buildDescription(captionEn, apparel) {
  let text = captionEn;

  // Hvis modellen ikke returnerer noget, lav en naturlig fallback
  if (!text || typeof text !== "string" || text.toLowerCase().includes("no")) {
    const fallback = [
      "med moderne snit",
      "i afslappet pasform",
      "i klassisk stil",
      "med tidløst design",
      "i minimalistisk look"
    ];
    const rand = fallback[Math.floor(Math.random() * fallback.length)];
    return `${capitalize(apparel)} – ${rand}`;
  }

  // Oversæt automatisk til dansk
  const translated = await translateToDanish(text);

  // Rens og gør det modeagtigt
  let clean = translated.replace(/et\s*billede\s*af/i, "").trim();
  if (!clean.match(/[.!?]$/)) clean += ".";
  return `${capitalize(apparel)} – ${clean}`;
}

// Gratis oversættelse til dansk via MyMemory API
async function translateToDanish(englishText) {
  try {
    const resp = await fetch(
      "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(englishText) +
        "&langpair=en|da"
    );
    const data = await resp.json();
    return data.responseData?.translatedText || englishText;
  } catch {
    return englishText;
  }
}

// 🧩 Hjælpefunktioner
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
