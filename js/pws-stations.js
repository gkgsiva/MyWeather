// Default Wunderground personal weather stations (nickname, station ID).
// Used the first time the Wunderground page is opened, and by
// "Restore the default list". Tambaram and Tambaram Sanatorium share a station.
export const DEFAULT_PWS = [
  { name: "Chrompet", id: "IPALLA22" },
  { name: "Nungambakkam-KWS", id: "ICHENNAI1" },
  { name: "Royapettah", id: "ICHENN47" },
  { name: "Kodungaiyur", id: "ICHENN92" },
  { name: "Perambur", id: "ICHENN62" },
  { name: "Padi-COMK", id: "ICHENN89" },
  { name: "Anna Nagar West", id: "ICHENN52" },
  { name: "Mogappair West", id: "ICHENN87" },
  { name: "Teynampet", id: "ICHENN78" },
  { name: "KK Nagar", id: "ICHENN63" },
  { name: "Mangadu", id: "IKUNDR1" },
  { name: "Neelankarai", id: "ICHENN94" },
  { name: "Nanmangalam", id: "ITAMBA28" },
  { name: "Pammal", id: "IPALLA26" },
  { name: "Tambaram Sanatorium", id: "ITAMBA20" },
  { name: "Tambaram", id: "ITAMBA20" },
  { name: "Perumbakkam", id: "ICHENNAI25" },
  { name: "New Perungalathur", id: "ICHENG26" },
  { name: "Padur", id: "IVANDA50" },
  { name: "Tiruvallur", id: "ITIRUV3" },
  { name: "Pudur-Vellore", id: "IPOLUR1" },
  { name: "White Town-Pondicherry", id: "IPONDI9" },
  { name: "Rajapalayam", id: "IRAJAP4" },
];

export function pwsUrl(id) {
  return `https://www.wunderground.com/dashboard/pws/${encodeURIComponent(id)}`;
}
