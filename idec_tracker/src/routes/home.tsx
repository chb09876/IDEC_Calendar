import { readFile } from "node:fs/promises";
import path from "node:path";
import App, { type LecturesPayload } from "./App";

export async function loader() {
  const lecturesPath = path.resolve(process.cwd(), "../public/lectures.json");
  const payload = JSON.parse(await readFile(lecturesPath, "utf-8")) as LecturesPayload;
  return payload;
}

export default function Home({ loaderData }: { loaderData: LecturesPayload }) {
  return <App initialPayload={loaderData} />;
}
