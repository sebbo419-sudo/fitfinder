// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch;

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;

    // 1️⃣ Analyser billedet med Clarifai
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

    // 2️⃣ Brug offentligt Hugging Face endpoint (ingen API-nøgle kræves)
    const imageUrl = body.inputs?.[0]?.data?.image?.url;
    const hfResp = await fetch(
      "https://hf.space/embed/Salesforce/BLIP/+/api/predict",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [imageUrl] })
      }
    );

    let captionEn = "No description found";
    if (hfResp.ok) {
      const hfData = await hfResp.json();
      // Hugging Face Spaces returnerer array under data[]
      if (hfData.data && hfData.data[0]) {
        captionEn = hfData.data[0];
      }
    }

    // 3️⃣ Oversæt til dansk
    const translated = await translateToDanish(captionEn);

    // 4️⃣ Gør det pænt og modeagtigt
    const styled = makeFashionDescription(translated, apparel);

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ apparel, description: styled })
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fejl i Clarifai-proxyen", details: err.message })
    };
  }
};

// 🧠 Oversættelse (gratis API)
async function translateToDanish(englishText) {
  if (!englishText) return "Ukendt beskrivelse";
  try {
    const resp = await fetch(
      "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(englishText) +
        "&langpair=en|da"
    );
    const data = await resp.json();
    return cleanupText(data.responseData?.translatedText || englishText);
  } catch {
    return englishText;
  }
}

// 💅 Modeagtig tekst
function makeFashionDescription(text, apparel) {
  let t = text.toLowerCase().replace(/^en person.*iført/i, "").trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const fits = ["i afslappet pasform", "i klassisk stil", "med moderne snit", "i stilren udførelse"];
  const fit = fits[Math.floor(Math.random() * fits.length)];
  return `${apparel.charAt(0).toUpperCase() + apparel.slice(1)} – ${t} ${fit}`;
}

// 🔤 Rens teksten
function cleanupText(text) {
  return text.replace(/(et|en)\s*billede\s*af\s*/i, "").replace(/\.$/, "").trim();
}
