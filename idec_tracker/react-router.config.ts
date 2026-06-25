import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  basename: process.env.BASE_URL ?? "/",
  ssr: false,
  prerender: ["/"],
} satisfies Config;
