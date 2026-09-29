import { sendMessage } from "./messages";
import { safeUrl } from "./safeUrl";

export async function openTab(url: string): Promise<boolean> {
  const res = await sendMessage({ type: "OPEN_TAB", url: safeUrl(url) });
  return res.ok;
}
