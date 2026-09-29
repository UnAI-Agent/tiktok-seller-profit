export function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

/** Prefill the in-overlay support form. Costs and profit stay out of the message. */
export function reportProblemDraft(input: {
  version: string;
  pageType: string;
  priceRead: boolean;
}): string {
  return [
    `Extension version: ${input.version || "unknown"}`,
    `Page type: ${input.pageType}`,
    `Price read: ${input.priceRead ? "yes" : "no"}`,
    "",
    "What happened:",
    "",
  ].join("\n");
}
