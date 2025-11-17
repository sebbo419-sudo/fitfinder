// netlify/functions/clarifai-proxy.js
const fetch = globalThis.fetch;

// Supabase config (Storage)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "images";

// Replicate CLIP model (text + image embeddings)
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_CLIP_VERSION =
  "108eb7dc5ef4392de2e885c219c2a2bdab552826bcbd3707987a967aa746d87e";

// Cache til tekst-embeddings (så vi ikke betaler for dem hver gang)
let FIT_TEXT_EMBEDDINGS_CACHE = null;
let PATTERN_TEXT_EMBEDDINGS_CACHE = null;

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const clarifaiKey = process.env.CLARIFAI_API_KEY;

    if (!clarifaiKey) {
      throw new Error("CLARIFAI_API_KEY mangler i environment");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error("SUPABASE_URL eller SUPABASE_SERVICE_KEY mangler i environment");
    }
    if (!REPLICATE_API_TOKEN) {
      console.warn("REPLICATE_API_TOKEN mangler – CLIP fallback til regular/plain");
    }

    // 1️⃣ Få tøjtype fra Clarifai
    const clarifaiResp = await fetch(
      "https://api.clarifai.com/v2/models/apparel-detection/outputs",
      {
        method: "POST",
        headers: {
          Authorization: `Key ${clarifaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const clarifaiData = await clarifaiResp.json();
    const concepts = clarifaiData.outputs?.[0]?.data?.concepts || [];
    const best = concepts.sort((a, b) => b.value - a.value)[0];
    const apparel = best?.name || "tøj";

    // 2️⃣ Hent base64 fra request
    let base64 = body.inputs?.[0]?.data?.image?.base64;
    if (!base64) throw new Error("Intet billede fundet i forespørgslen");

    // Fjern evt. data-URL prefix
    base64 = base64.replace(/^data:image\/\w+;base64,/, "");

    // 3️⃣ Upload til Supabase Storage og få en offentlig URL
    const imageUrl = await uploadImageToSupabase(base64);

    // 4️⃣ Fit + mønster via CLIP (eller fallback hvis REPLICATE_API_TOKEN mangler)
    const fit = REPLICATE_API_TOKEN
      ? await inferFit(imageUrl)
      : "regular";
    const pattern = REPLICATE_API_TOKEN
      ? await inferPattern(imageUrl)
      : "plain";

    // 5️⃣ Byg beskrivelse
    const finalDescription = await buildDescription(null, apparel, fit, pattern);

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        apparel,
        fit,
        pattern,
        imageUrl,
        description: finalDescription,
      }),
    };
  } catch (err) {
    console.error("Fejl i proxy:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Fejl i Clarifai-proxyen",
        details: err.message,
      }),
    };
  }
};

//
// ------------------- Supabase upload -------------------
//

async function uploadImageToSupabase(base64) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase config mangler");
  }

  const buffer = Buffer.from(base64, "base64");
  const fileName =
    "outfits/" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2) +
    ".jpg";

  const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${fileName}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "image/jpeg",
    },
    body: buffer,
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("Supabase upload fejl:", text);
    throw new Error("Supabase upload fejlede: " + text);
  }

  // Hvis bucket er public, er dette den offentlige URL
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${fileName}`;
  return publicUrl;
}

//
// ------------------- CLIP HELPER -------------------
//

async function callReplicateClip(input) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN ikke sat");
  }

  // Start prediction
  const startResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: REPLICATE_CLIP_VERSION,
      input,
    }),
  });

  if (!startResp.ok) {
    const text = await startResp.text();
    throw new Error("Replicate start-fejl: " + text);
  }

  let prediction = await startResp.json();

  // Poll indtil den er færdig
  while (prediction.status === "starting" || prediction.status === "processing") {
    await sleep(700);
    const pollResp = await fetch(prediction.urls.get, {
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    prediction = await pollResp.json();
  }

  if (prediction.status !== "succeeded") {
    throw new Error("Replicate prediction fejlede: " + prediction.status);
  }

  const output = prediction.output;
  if (!output || !output.embedding) {
    throw new Error("Replicate output uden embedding");
  }

  return output.embedding;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getImageEmbedding(imageUrl) {
  return callReplicateClip({ image: imageUrl });
}

async function getTextEmbedding(text) {
  return callReplicateClip({ text });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

//
// -------------- FIT VIA CLIP ----------------
//

const FIT_OPTIONS = [
  { id: "oversized", text: "oversized loose fit sweater" },
  { id: "regular", text: "regular fit sweater" },
  { id: "slim", text: "slim fit sweater" },
  { id: "relaxed", text: "relaxed fit sweatshirt with loose fit" },
];

async function inferFit(imageUrl) {
  try {
    const imageEmbedding = await getImageEmbedding(imageUrl);
    if (!FIT_TEXT_EMBEDDINGS_CACHE) {
      const embeddings = await Promise.all(
        FIT_OPTIONS.map((opt) => getTextEmbedding(opt.text))
      );
      FIT_TEXT_EMBEDDINGS_CACHE = FIT_OPTIONS.map((opt, i) => ({
        id: opt.id,
        embedding: embeddings[i],
      }));
    }

    let best = { id: "regular", score: -1 };
    for (const opt of FIT_TEXT_EMBEDDINGS_CACHE) {
      const score = cosineSimilarity(imageEmbedding, opt.embedding);
      if (score > best.score) {
        best = { id: opt.id, score };
      }
    }
    console.log("CLIP fit:", best);
    return best.id || "regular";
  } catch (e) {
    console.warn("inferFit fejl, fallback til regular:", e.message);
    return "regular";
  }
}

//
// -------------- PATTERN VIA CLIP ----------------
//

const PATTERN_OPTIONS = [
  { id: "plain", text: "plain solid color fabric" },
  { id: "striped", text: "striped fabric with visible stripes" },
  { id: "checked", text: "checked plaid fabric pattern" },
  { id: "floral", text: "floral patterned fabric with flowers" },
  { id: "melange", text: "melange knit fabric texture" },
  { id: "printed", text: "graphic printed fabric with graphics" },
];

async function inferPattern(imageUrl) {
  try {
    const imageEmbedding = await getImageEmbedding(imageUrl);
    if (!PATTERN_TEXT_EMBEDDINGS_CACHE) {
      const embeddings = await Promise.all(
        PATTERN_OPTIONS.map((opt) => getTextEmbedding(opt.text))
      );
      PATTERN_TEXT_EMBEDDINGS_CACHE = PATTERN_OPTIONS.map((opt, i) => ({
        id: opt.id,
        embedding: embeddings[i],
      }));
    }

    let best = { id: "plain", score: -1 };
    for (const opt of PATTERN_TEXT_EMBEDDINGS_CACHE) {
      const score = cosineSimilarity(imageEmbedding, opt.embedding);
      if (score > best.score) {
        best = { id: opt.id, score };
      }
    }
    console.log("CLIP pattern:", best);
    return best.id || "plain";
  } catch (e) {
    console.warn("inferPattern fejl, fallback til plain:", e.message);
    return "plain";
  }
}

//
// -------------------- Beskrivelse --------------------
//
async function buildDescription(caption, apparel, fit, pattern) {
  const FIT_LABELS_DA = {
    oversized: "oversized fit",
    regular: "regular fit",
    slim: "slim fit",
    relaxed: "løstsiddende pasform",
  };

  const PATTERN_LABELS_DA = {
    plain: "uden mønster",
    striped: "med striber",
    checked: "med tern",
    floral: "med blomsterprint",
    melange: "i meleret strik",
    printed: "med print",
  };

  const fitText = FIT_LABELS_DA[fit] || "regular fit";
  const patternText = PATTERN_LABELS_DA[pattern] || "";

  let desc = `${capitalize(apparel)} i ${fitText}`;
  if (patternText) desc += " " + patternText;

  return desc;
}

//
// ---------------- utils ----------------
//
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
