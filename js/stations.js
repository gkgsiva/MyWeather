// IMD Doppler Weather Radar stations and products.
//
// Source: https://mausam.imd.gov.in/responsive/radar.php?id=<City>
// Each station page shows images at
//   https://mausam.imd.gov.in/Radar/<product>_<code>.gif
// The station codes below were read from those pages (Nov 2026). They are not
// derivable from the city name (e.g. Mumbai -> "vrv", Sohra -> "cpj"), so new
// stations must be added here by hand.

export const IMD_RADAR_BASE = "https://mausam.imd.gov.in/Radar/";

export const STATIONS = [
  { name: "Agartala", code: "agt" },
  { name: "Banihal", code: "bnh" },
  { name: "Bhopal", code: "bhp" },
  { name: "Bhuj", code: "bhj" },
  { name: "Chennai", code: "cni" },
  { name: "Delhi (HQ)", code: "delhi" },
  { name: "Delhi (Ayanagar)", code: "aya" },
  { name: "Delhi (Palam)", code: "dlh" },
  { name: "Goa", code: "goa" },
  { name: "Gopalpur", code: "gop" },
  { name: "Hyderabad", code: "hyd" },
  { name: "Jaipur", code: "jpr" },
  { name: "Jammu", code: "jmu" },
  { name: "Jot", code: "jot" },
  { name: "Karaikal", code: "kkl" },
  { name: "Kochi", code: "koc" },
  { name: "Kolkata", code: "kol" },
  { name: "Kufri", code: "kuf" },
  { name: "Lansdowne", code: "ldn" },
  { name: "Leh", code: "leh" },
  { name: "Lucknow", code: "lkn" },
  { name: "Machilipatnam", code: "mpt" },
  { name: "Mohanbari", code: "mbr" },
  { name: "Mukteshwar", code: "mks" },
  { name: "Mumbai", code: "vrv" },
  { name: "Murari", code: "mur" },
  { name: "Nagpur", code: "ngp" },
  { name: "Paradip", code: "pdp" },
  { name: "Patiala", code: "ptl" },
  { name: "Patna", code: "ptn" },
  { name: "Raipur", code: "rpr" },
  { name: "Sohra (Cherrapunji)", code: "cpj" },
  { name: "Srinagar", code: "srn" },
  { name: "Sriharikota", code: "shr" },
  { name: "Thiruvananthapuram", code: "tvm" },
  { name: "Visakhapatnam", code: "vsk" },
];

export const PRODUCTS = [
  { code: "caz", name: "MAX (Z)" },
  { code: "ppi", name: "Plan Position Indicator (Z) – close range" },
  { code: "ppz", name: "Plan Position Indicator (Z)" },
  { code: "ppv", name: "Plan Position Indicator (V)" },
  { code: "sri", name: "Surface Rainfall Intensity" },
  { code: "pac", name: "Precipitation Accumulation" },
  { code: "vp2", name: "Volume Velocity Processing (2)" },
];

export function radarImageUrl(stationCode, productCode = "caz") {
  return `${IMD_RADAR_BASE}${productCode}_${stationCode}.gif`;
}
