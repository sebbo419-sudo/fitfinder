// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch;

// Upload via imgbb (kræver din egen nøgle i Netlify environment)
const IMGBB_API = `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`;

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
    let base64 = body.inputs?.[0]?.data?.image?.base64;
    if (!base64) throw new Error("Intet billede fundet i forespørgslen");

    // Fjern evt. data-URL prefix
    base64 = base64.replace(/^data:image\/\w+;base64,/, "");

    const formData = new FormData();
    formData.append("image", base64);

    const uploadResp = await fetch(IMGBB_API, { method: "POST", body: formData });
    const uploadData = await uploadResp.json();

    if (!uploadData.success) {
      console.error("imgbb upload error:", uploadData);
      throw new Error(uploadData.error?.message || "imgbb upload mislykkedes");
    }

    const imageUrl = uploadData.data.url;
    if (!imageUrl) throw new Error("Kunne ikke hente billed-URL fra imgbb");

    // 3️⃣ Send til Hugging Face BLIP for billedbeskrivelse (nyt setup)
    let hfUrl;
    const hfHeaders = { "Content-Type": "application/json" };

    if (process.env.HUGGINGFACE_API_KEY) {
      // Brug privat token med v2 API
      hfUrl = "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large";
      hfHeaders["Authorization"] = `Bearer ${process.env.HUGGINGFACE_API_KEY}`;
    } else {
      // Fald tilbage til offentlig router (langsommere)
      hfUrl = "https://router.huggingface.co/hf-inference/models/Salesforce/blip-image-captioning-large";
    }

    const hfResp = await fetch(hfUrl, {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({ inputs: imageUrl })
    });

    let caption = null;
    if (hfResp.ok) {
      const hfData = await hfResp.json();
      caption = hfData?.[0]?.generated_text || hfData?.generated_text || null;
    } else {
      console.warn("Hugging Face fejlede:", await hfResp.text());
    }

    // 4️⃣ Oversæt og formater resultatet
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
      headers: { "Access-Control-Allow-Origin": "*" },
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

// 🌍 Gratis oversættelse via MyMemory
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
