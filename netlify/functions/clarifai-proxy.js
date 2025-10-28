import { fetch } from "undici";

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // 1️⃣ Send billedet til Clarifai
    const clarifaiResp = await fetch(
      "https://api.clarifai.com/v2/models/apparel-recognition/versions/dc2cd6d9bff5425a80bfe0c4105583c1/outputs",
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${clarifaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const clarifaiData = await clarifaiResp.json();
    const concepts = clarifaiData.outputs?.[0]?.data?.concepts || [];
    const best = concepts.sort((a, b) => b.value - a.value)[0];
    const apparel = best?.name || "Ukendt";
    const confidence = Math.round((best?.value || 0) * 100);

    // 2️⃣ Lav en prompt til OpenAI
    const prompt = `
Du er en dansk tøjbeskriver. 
Lav en kort og naturlig beskrivelse (maks 25 ord) af et stykke tøj ud fra disse oplysninger:
Tøjtype: ${apparel}
Farve (hvis kendt): ${body.color || "ukendt"}
Pasform og detaljer (gæt hvis muligt).
Svar kun med den endelige danske beskrivelse.`;

    // 3️⃣ Send til OpenAI for at få en flot sætning
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    const openaiData = await openaiResp.json();
    const description =
      openaiData.choices?.[0]?.message?.content?.trim() ||
      `Et stykke tøj (${apparel.toLowerCase()})`;

    // 4️⃣ Returnér samlet svar til browseren
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        confidence,
        description,
        raw: concepts,
        outputs: clarifaiData.outputs,
      }),
    };
  } catch (err) {
    console.error("Fejl i AI-proxy:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Fejl i AI-proxyen",
        details: err.message,
      }),
    };
  }
};
