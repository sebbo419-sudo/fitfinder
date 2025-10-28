export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const clarifaiKey = process.env.CLARIFAI_API_KEY;
    const hfKey = process.env.HUGGINGFACE_API_KEY;

    // 📸 Accepter både base64 og URL
    const imageData =
      body.inputs?.[0]?.data?.image?.base64 ||
      body.inputs?.[0]?.data?.image?.url;

    if (!imageData) {
      return { statusCode: 400, body: JSON.stringify({ error: "Intet billede fundet" }) };
    }

    // 1️⃣ Find tøjtype via Clarifai
    const clarifaiResp = await fetch(
      "https://api.clarifai.com/v2/models/apparel-detection/outputs",
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${clarifaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: [{ data: { image: { base64: imageData } } }] }),
      }
    );

    const clarifaiData = await clarifaiResp.json();
    const concepts = clarifaiData.outputs?.[0]?.data?.concepts || [];
    const best = concepts.sort((a, b) => b.value - a.value)[0];
    const apparel = best?.name || "ukendt tøj";

    // 2️⃣ Generér billedbeskrivelse (engelsk)
    const hfResp = await fetch(
      "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: `data:image/jpeg;base64,${imageData}` }),
      }
    );

    const hfData = await hfResp.json();
    const captionEn = hfData?.[0]?.generated_text || "no description found";

    // 3️⃣ Oversæt til dansk
    const translateResp = await fetch(
      "https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-en-da",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: captionEn }),
      }
    );

    const translateData = await translateResp.json();
    const captionDa =
      translateData?.[0]?.translation_text?.trim() || captionEn;

    // 4️⃣ Forbedr tekst (modeskribent-stil)
    const polishPrompt = `Omskriv følgende danske tøjbeskrivelse, så den lyder som en kort modeskribentbeskrivelse. Brug naturlig tone, fx “En marineblå striktrøje i afslappet pasform med rund hals.”:\n\n"${captionDa}"`;

    const polishResp = await fetch(
      "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: polishPrompt }),
      }
    );

    const polishData = await polishResp.json();
    const polished =
      polishData?.[0]?.generated_text?.trim() ||
      captionDa.charAt(0).toUpperCase() + captionDa.slice(1);

    // 5️⃣ Kombinér i slutresultat
    const description = `${polished} (${apparel}).`;

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        description,
        clarifaiRaw: concepts,
        hfRaw: hfData,
        translationRaw: translateData,
        polishRaw: polishData,
      }),
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Fejl i Clarifai/Hugging Face-proxyen",
        details: err.message,
      }),
    };
  }
};
