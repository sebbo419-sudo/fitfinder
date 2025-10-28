// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch;

// Midlertidig upload via imgbb (gratis, uden konto)
const IMGBB_API = "https://api.imgbb.com/1/upload?key=bb5b1fc0aef8c27c841b5b1c2c5934d1";

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;

    // 1️⃣ Få tøjtype fra Clarifai
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

    // 2️⃣ Upload billedet til imgbb for at få URL
    const base64 = body.inputs?.[0]?.data?.image?.base64;
    if (!base64) throw new Error("Intet billede fundet i forespørgslen");
    const uploadResp = await fetch(IMGBB_API, {
      method: "POST",
      body: new URLSearchParams({ image: base64 })
    });
    const uploadData = await uploadResp.json();
    const imageUrl = uploadData.data?.url;
    if (!imageUrl) throw new Error("Kunne ikke uploade billede til imgbb");

    // 3️⃣ Send til Hugging Face BLIP for beskrivelse
    const hfResp = await fetch("https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: imageUrl })
    });

    let caption = null;
    if (hfResp.ok) {
      const hfData = await hfResp.json();
      caption = hfData?.[0]?.generated_text || hfData?.generated_text || null;
    }

    // 4️⃣ Oversæt og formater
    const finalDescription = await buildDescription(caption, apparel);

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

// 🧠 Oversæt og lav pæn modebeskrivelse
async function buildDescription(caption, apparel) {
  const fallback = [
    "med moderne snit",
    "i klassisk pasform",
    "i stilrent design",
    "med afslappet look",
    "i tidløs stil"
  ];

  if (!caption || caption.toLowerCase().includes("no")) {
    return `${capitalize(apparel)} – ${fallback[Math.floor(Math.random() * fallback.length)]}`;
  }

  const translated = await translateToDanish(caption);
  return `${capitalize(apparel)} – ${translated.charAt(0).toLowerCase() + translated.slice(1)}`;
}

// Gratis oversættelse
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
