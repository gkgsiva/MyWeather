// Places in and around Chennai that are known to flood or waterlog in heavy
// rain: low-lying neighbourhoods along the Adyar, Cooum, Buckingham Canal and
// Pallikaranai marsh, and road subways that fill up and get closed. Put
// together from places repeatedly named in news reports and Greater Chennai
// Corporation's subway closures in the 2015, 2021 and 2023 (Michaung) floods.
// Positions are approximate (the neighbourhood or the subway, to a few hundred
// metres). Spots can be added on the phone from the Flood spots screen.
//
// kind: "area" (low-lying neighbourhood) or "subway" (road under a railway).
export const FLOOD_SPOTS = [
  // South: Pallikaranai marsh and the Velachery basin
  { name: "Velachery (Vijayanagar, Ram Nagar)", kind: "area", lat: 12.9787, lon: 80.2185 },
  { name: "Pallikaranai", kind: "area", lat: 12.9375, lon: 80.2125 },
  { name: "Madipakkam", kind: "area", lat: 12.9625, lon: 80.1985 },
  { name: "Thoraipakkam (OMR)", kind: "area", lat: 12.9395, lon: 80.2335 },
  { name: "Perumbakkam", kind: "area", lat: 12.9035, lon: 80.1965 },
  { name: "Semmencherry", kind: "area", lat: 12.8645, lon: 80.2235 },
  { name: "Keelkattalai", kind: "area", lat: 12.9555, lon: 80.1865 },
  // South-west: Adyar basin and the Tambaram side
  { name: "Mudichur & Varadharajapuram", kind: "area", lat: 12.9155, lon: 80.0715 },
  { name: "Tambaram West", kind: "area", lat: 12.9245, lon: 80.1045 },
  { name: "Anakaputhur", kind: "area", lat: 12.9805, lon: 80.1245 },
  { name: "Pammal", kind: "area", lat: 12.9745, lon: 80.1355 },
  { name: "Manapakkam & Mugalivakkam", kind: "area", lat: 13.0195, lon: 80.1625 },
  { name: "Ramapuram", kind: "area", lat: 13.0315, lon: 80.1785 },
  // Along the Adyar
  { name: "Jafferkhanpet", kind: "area", lat: 13.0285, lon: 80.2085 },
  { name: "Saidapet (Adyar bank)", kind: "area", lat: 13.0215, lon: 80.2235 },
  { name: "Kotturpuram", kind: "area", lat: 13.0185, lon: 80.2415 },
  // West and central
  { name: "K.K. Nagar", kind: "area", lat: 13.0395, lon: 80.1995 },
  { name: "Ashok Nagar", kind: "area", lat: 13.0375, lon: 80.2125 },
  { name: "T. Nagar (Usman Road, Pondy Bazaar)", kind: "area", lat: 13.0405, lon: 80.2335 },
  { name: "Virugambakkam", kind: "area", lat: 13.0535, lon: 80.1945 },
  { name: "Valasaravakkam", kind: "area", lat: 13.0405, lon: 80.1725 },
  { name: "Choolaimedu", kind: "area", lat: 13.0635, lon: 80.2245 },
  { name: "Mylapore (Luz, R.K. Mutt Road)", kind: "area", lat: 13.0335, lon: 80.2685 },
  // North and north-west
  { name: "Korattur", kind: "area", lat: 13.1085, lon: 80.1845 },
  { name: "Ambattur", kind: "area", lat: 13.1145, lon: 80.1545 },
  { name: "Mogappair", kind: "area", lat: 13.0845, lon: 80.1755 },
  { name: "Kolathur", kind: "area", lat: 13.1245, lon: 80.2125 },
  { name: "Perambur", kind: "area", lat: 13.1175, lon: 80.2335 },
  { name: "Vyasarpadi", kind: "area", lat: 13.1175, lon: 80.2575 },
  { name: "Pulianthope", kind: "area", lat: 13.0965, lon: 80.2645 },
  { name: "Kodungaiyur", kind: "area", lat: 13.1375, lon: 80.2475 },
  { name: "Washermanpet", kind: "area", lat: 13.1135, lon: 80.2875 },
  { name: "Tiruvottiyur", kind: "area", lat: 13.1605, lon: 80.3005 },
  { name: "Manali", kind: "area", lat: 13.1665, lon: 80.2605 },
  // Subways that fill up and are closed in heavy rain
  { name: "Madley Road subway (T. Nagar)", kind: "subway", lat: 13.0378, lon: 80.2283 },
  { name: "Duraisamy subway (West Mambalam)", kind: "subway", lat: 13.0393, lon: 80.2252 },
  { name: "Rangarajapuram subway (Kodambakkam)", kind: "subway", lat: 13.0495, lon: 80.2265 },
  { name: "Aranganathan subway (Saidapet)", kind: "subway", lat: 13.0255, lon: 80.2245 },
  { name: "Ganesapuram subway (Vyasarpadi)", kind: "subway", lat: 13.1195, lon: 80.2625 },
  { name: "Villivakkam subway", kind: "subway", lat: 13.1065, lon: 80.2055 },
  { name: "Perambur (Jamalia) subway", kind: "subway", lat: 13.1105, lon: 80.2405 },
  { name: "Gengu Reddy subway (Egmore)", kind: "subway", lat: 13.0785, lon: 80.2575 },
];
