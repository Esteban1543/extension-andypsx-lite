export const definition = {
  id: "bajo-consumo",
  name: "Bajo consumo",
  description:
    "Corta las animaciones decorativas de la web (la página queda estática) para gastar la mínima CPU. No requiere sesión iniciada.",
  matches: ["/*"],
  defaultEnabled: true,
  hasContent: false,
  styles: ["low-cpu.css"],
};
