export const definition = {
  id: "vista-limpia",
  name: "Vista limpia",
  description: "Reordena el directo en 5 columnas y oculta lo que no hace falta.",
  matches: ["/*"],
  defaultEnabled: true,
  legacyState: true,
  hasContent: false,
  requiresSession: true,
  styles: ["live.css"],
};
