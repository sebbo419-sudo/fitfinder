import { fetch } from "undici";

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // 1️⃣ Kald Clarifai for at finde tøjtype
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
    const apparel = best?.name || "ukendt tøjtype";
    const confidence = Math.round((best?.value || 0) * 100);

    // 2️⃣ Lav prompt til OpenAI
    const prompt = `
Du er en dansk stylist-AI. 
Lav en kort og naturlig beskrivelse (maks 25 ord) af et stykke tøj ud fra disse oplysninger:
Tøjtype: ${apparel}
Farve (hvis kendt): ${body.color || "ukendt"}
Pasform og materiale (gæt hvis muligt).
Skriv på flydende dansk – fx "En marineblå striktrøje med rund hals og afslappet pasform".
`;

    // 3️⃣ Kald OpenAI
    let description = "";
    try {
      const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 80,
          temperature: 0.7,
        }),
      });

      const openaiData = await openaiResp.json();

      if (openaiData.error) {
        console.error("OpenAI fejl:", openaiData.error);
        description = `En ${apparel.toLowerCase()} i ${body.color || "neutral farve"}`;
      } else {
        description =
          openaiData.choices?.[0]?.message?.content?.trim() ||
          `En ${apparel.toLowerCase()} i ${body.color || "neutral farve"}`;
      }
    } catch (e) {
      console.error("Fejl under OpenAI-kald:", e);
      description = `En ${apparel.toLowerCase()} i ${body.color || "neutral farve"}`;
    }

    // 4️⃣ Returnér resultat
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
