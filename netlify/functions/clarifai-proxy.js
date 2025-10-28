import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;
    const hfKey = process.env.HUGGINGFACE_API_KEY;

    // 1️⃣ Først: få tøjet fra Clarifai
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
    const apparel = best?.name || "Ukendt tøj";
    const confidence = Math.round((best?.value || 0) * 100);

    // 2️⃣ Dernæst: generér tekstbeskrivelse via Hugging Face (BLIP-2)
    const base64 = body.inputs?.[0]?.data?.image?.base64;
    let description = "Et stykke tøj";

    if (hfKey && base64) {
      const imgBytes = Buffer.from(base64, "base64");
      const hfResp = await fetch(
        "https://api-inference.huggingface.co/models/Salesforce/blip2-flan-t5-xl",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${hfKey}`,
            "Content-Type": "application/octet-stream",
          },
          body: imgBytes,
        }
      );

      const hfData = await hfResp.json();
      if (Array.isArray(hfData) && hfData[0]?.generated_text) {
        description = hfData[0].generated_text;
      }
    }

    // 3️⃣ Returnér samlet resultat
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        confidence,
        description, // 💬 tekst fra Hugging Face
        raw: concepts
      })
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fejl i proxy-funktion", details: err.message })
    };
  }
};
