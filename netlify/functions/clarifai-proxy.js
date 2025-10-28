// netlify/functions/clarifai-proxy.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;

    // Bruger Clarifais "apparel-recognition" model
    const resp = await fetch(
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

    const data = await resp.json();
    const concepts = data.outputs?.[0]?.data?.concepts || [];
    const best = concepts.sort((a, b) => b.value - a.value)[0];

    const apparel = best?.name || "Ukendt";
    const confidence = Math.round((best?.value || 0) * 100);

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        confidence,
        raw: concepts, // sender hele listen videre (valgfrit)
        outputs: data.outputs,
      }),
    };
  } catch (err) {
    console.error("Clarifai fejl:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Fejl i Clarifai-proxyen",
        details: err.message,
      }),
    };
  }
};
