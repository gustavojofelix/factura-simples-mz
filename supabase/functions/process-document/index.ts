import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExtractedData {
  nuit?: string;
  tradeName?: string;
  address?: string;
  province?: string;
  district?: string;
  administrativePost?: string;
  mainActivity?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { document, documentType, mimeType } = await req.json();

    if (!document || !documentType) {
      throw new Error("Missing required fields");
    }

    const extractedData = await extractDataFromDocument(
      document,
      documentType,
      mimeType
    );

    return new Response(
      JSON.stringify({ extractedData }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing document:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

async function extractDataFromDocument(
  base64Document: string,
  documentType: string,
  mimeType: string
): Promise<ExtractedData> {
  const GOOGLE_VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY");

  if (!GOOGLE_VISION_API_KEY) {
    console.warn("Google Vision API key not configured. Returning empty data.");
    return {};
  }

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: base64Document,
              },
              features: [
                {
                  type: "DOCUMENT_TEXT_DETECTION",
                },
              ],
            },
          ],
        }),
      }
    );

    const result = await response.json();
    const text = result.responses[0]?.fullTextAnnotation?.text || "";

    return parseDocumentText(text, documentType);
  } catch (error) {
    console.error("Error calling Google Vision API:", error);
    return {};
  }
}

function parseDocumentText(
  text: string,
  documentType: string
): ExtractedData {
  const data: ExtractedData = {};

  const nuitMatch = text.match(/NUIT[:\s]*([0-9]{9})/i);
  if (nuitMatch) {
    data.nuit = nuitMatch[1];
  }

  const tradeNameMatches = [
    /Nome\s+Comercial[:\s]*([^\n]+)/i,
    /Denominação[:\s]*([^\n]+)/i,
    /Firma[:\s]*([^\n]+)/i,
  ];
  for (const pattern of tradeNameMatches) {
    const match = text.match(pattern);
    if (match) {
      data.tradeName = match[1].trim();
      break;
    }
  }

  const addressMatches = [
    /Endereço[:\s]*([^\n]+)/i,
    /Morada[:\s]*([^\n]+)/i,
    /Localização[:\s]*([^\n]+)/i,
  ];
  for (const pattern of addressMatches) {
    const match = text.match(pattern);
    if (match) {
      data.address = match[1].trim();
      break;
    }
  }

  const provinceMatch = text.match(/Província[:\s]*([^\n]+)/i);
  if (provinceMatch) {
    data.province = provinceMatch[1].trim();
  }

  const districtMatch = text.match(/Distrito[:\s]*([^\n]+)/i);
  if (districtMatch) {
    data.district = districtMatch[1].trim();
  }

  const postMatch = text.match(/Posto\s+Administrativo[:\s]*([^\n]+)/i);
  if (postMatch) {
    data.administrativePost = postMatch[1].trim();
  }

  const activityMatches = [
    /Actividade\s+Principal[:\s]*([^\n]+)/i,
    /Atividade\s+Principal[:\s]*([^\n]+)/i,
    /Objecto[:\s]*([^\n]+)/i,
  ];
  for (const pattern of activityMatches) {
    const match = text.match(pattern);
    if (match) {
      data.mainActivity = match[1].trim();
      break;
    }
  }

  return data;
}
