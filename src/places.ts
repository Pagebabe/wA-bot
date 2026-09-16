export type StructuredPlace = {
  placeId: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

function requireKey(apiKey?: string | null) {
  if (!apiKey) throw new Error("Google Places ist nicht konfiguriert");
  return apiKey;
}

export async function autocompletePlaces(
  input: string,
  apiKey = process.env.GOOGLE_MAPS_API_KEY,
): Promise<Array<{ placeId: string; text: string }>> {
  const query = String(input || "").trim();
  if (query.length < 3) return [];
  const response = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": requireKey(apiKey),
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input: query,
        languageCode: "de",
        regionCode: "DE",
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Google Places Suche fehlgeschlagen (${response.status})`);
  const payload: any = await response.json();
  return (payload.suggestions || []).flatMap((item: any) =>
    item?.placePrediction?.placeId
      ? [
          {
            placeId: item.placePrediction.placeId,
            text: String(item.placePrediction.text?.text || ""),
          },
        ]
      : [],
  );
}

export async function getPlaceDetails(
  placeId: string,
  apiKey = process.env.GOOGLE_MAPS_API_KEY,
): Promise<StructuredPlace> {
  const id = String(placeId || "").trim();
  if (!id) throw new Error("Place-ID fehlt");
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
    {
      headers: {
        "X-Goog-Api-Key": requireKey(apiKey),
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `Google Places Details fehlgeschlagen (${response.status})`,
    );
  const payload: any = await response.json();
  const latitude = Number(payload?.location?.latitude);
  const longitude = Number(payload?.location?.longitude);
  const address = String(payload?.formattedAddress || "").trim();
  if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw new Error("Google Places lieferte keinen vollständigen Standort");
  return {
    placeId: String(payload.id || id),
    label: String(payload?.displayName?.text || address),
    address,
    latitude,
    longitude,
  };
}
