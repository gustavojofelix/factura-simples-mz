import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type EmailLanguage, type Localized, normalizeLanguage, pick } from "../_shared/i18n.ts";

// Extracção de dados (OCR, Google Vision) de documentos da empresa. Não usa
// modelo de linguagem: os dados extraídos são devolvidos tal como aparecem no
// documento. O corpo pode trazer `language` ('pt-MZ' | 'en-GB' | 'fr-FR'),
// usado nas mensagens de erro.

const MSG = {
  missingFields: {
    "pt-MZ": "Faltam campos obrigatórios (document, documentType).",
    "en-GB": "Required fields are missing (document, documentType).",
    "fr-FR": "Des champs obligatoires sont manquants (document, documentType).",
  },
  failed: {
    "pt-MZ": "Não foi possível processar o documento.",
    "en-GB": "Could not process the document.",
    "fr-FR": "Impossible de traiter le document.",
  },
} satisfies Record<string, Localized>;

class RequestError extends Error {}

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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let lang: EmailLanguage = "pt-MZ";
  try {
    const { document, documentType, mimeType, language } = await req.json();
    lang = normalizeLanguage(language);

    if (!document || !documentType) {
      throw new RequestError(pick(MSG.missingFields, lang));
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
    const message = error instanceof RequestError ? error.message : pick(MSG.failed, lang);
    return new Response(
      JSON.stringify({ error: message }),
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

  return data;
}
