// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch; // ✅ Bruger indbygget fetch (hurtigere og mere stabil)

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;
    const hfKey = process.env.HUGGINGFACE_API_KEY;

    // ---- 1️⃣ Clarifai: tøjgenkendelse ----
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

    // ---- 2️⃣ Hugging Face: billedbeskrivelse ----
    const hfResp = await fetch(
      "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    let hfData = null;
    let captionEn = "no description found";
    try {
      hfData = await hfResp.json();
      if (Array.isArray(hfData) && hfData[0]?.generated_text) {
        captionEn = hfData[0].generated_text;
      } else if (hfData.error) {
        console.error("HF API-fejl:", hfData.error);
      }
    } catch (err) {
      console.error("Kunne ikke parse Hugging Face JSON:", err);
    }

    // ---- 3️⃣ Oversættelse til dansk ----
    const translated = await translateToDanish(captionEn);

    // ---- 4️⃣ Gør den modeagtig og naturlig ----
    const styled = makeFashionDescription(translated, apparel);

    // ---- 5️⃣ Svar tilbage til din hjemmeside ----
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        description: styled,
        clarifai: concepts,
        captionEn
      })
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fejl i Clarifai-proxyen", details: err.message })
    };
  }
};

// ---- 🔤 Oversættelse via gratis API ----
async function translateToDanish(englishText) {
  if (!englishText) return "Ukendt tøjbeskrivelse";
  try {
    const resp = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(englishText) + "&langpair=en|da");
    const data = await resp.json();
    const translated = data.responseData?.translatedText || englishText;
    return cleanupText(translated);
  } catch {
    return englishText;
  }
}

// ---- 💅 Gør teksten levende og modeagtig ----
function makeFashionDescription(text, apparel) {
  const clean = text
    .replace(/^en\s*person.*?iført/i, "")
    .replace(/^et\s*billede\s*af/i, "")
    .replace(/^en\s*billede\s*af/i, "")
    .replace(/^\s*af\s*/i, "")
    .replace(/\bholder\b.*$/i, "")
    .trim();

  // Grundlæggende sætning
  let result = clean.charAt(0).toUpperCase() + clean.slice(1);
  result = result.replace(/\.$/, "");

  // Typiske modeforbedringer
  const replacements = {
    "trøje": "striktrøje",
    "sweater": "striktrøje",
    "shirt": "skjorte",
    "t-shirt": "t-shirt",
    "top": "bluse",
    "hoodie": "hættebluse",
    "jacket": "jakke",
    "coat": "frakke",
    "pants": "bukser"
  };
  for (const [eng, da] of Object.entries(replacements)) {
    result = result.replace(new RegExp("\\b" + eng + "\\b", "gi"), da);
  }

  // Farvefornemmelse fra Clarifai
  const colorHints = {
    blue: "marineblå",
    black: "sort",
    white: "hvid",
    red: "rød",
    green: "grøn",
    brown: "brun",
    beige: "beige",
    gray: "grå"
  };
  for (const [eng, da] of Object.entries(colorHints)) {
    if (apparel.toLowerCase().includes(eng) && !result.toLowerCase().includes(da)) {
      result = `${da} ${result}`;
      break;
    }
  }

  // Beskriv stil og pasform
  const fits = ["i afslappet pasform", "i moderne snit", "til daglig brug", "med klassisk look"];
  const fit = fits[Math.floor(Math.random() * fits.length)];

  // Sammensæt den endelige sætning
  if (!result.toLowerCase().includes("tøj")) {
    result = result.replace(/^Et|En/i, "En");
    if (!result.toLowerCase().includes("pasform")) result += " " + fit;
  }

  return result.trim() || "Et stykke tøj i stilren udførelse";
}

// ---- 🧼 Ryd op i oversættelser ----
function cleanupText(text) {
  return text
    .replace(/\bEt billede af\b/i, "")
    .replace(/\bEn person der\b/i, "")
    .replace(/\biført\b/i, "")
    .replace(/^,/, "")
    .trim();
}
