export const definition = {
  id: "raffles",
  name: "Raffles",
  description:
    "Participa en raffles sin contraseña con esperas aleatorias y clics humanos.",
  matches: ["/*"],
  defaultEnabled: true,
  hasContent: true,
  defaultSettings: {
    trustedClicks: false,
  },
};
