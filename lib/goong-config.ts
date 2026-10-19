import { HANOI_LOCATION } from "./regional";

export function goongSearchLocation(lat: string | null, lng: string | null) {
  const latitude = Number(lat),
    longitude = Number(lng);
  const valid =
    lat !== null &&
    lat.trim() !== "" &&
    lng !== null &&
    lng.trim() !== "" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  return valid
    ? `${latitude},${longitude}`
    : `${HANOI_LOCATION.lat},${HANOI_LOCATION.lng}`;
}
