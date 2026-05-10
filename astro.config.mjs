import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://blairhudson.com",
  base: "/agile-weekend",
  output: "static",
  integrations: [react()],
});
