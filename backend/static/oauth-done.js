(function () {
  "use strict";
  const data = document.getElementById("tst-oauth-ticket");
  const ticket = data?.getAttribute("data-ticket") || "";
  const extensionId = data?.getAttribute("data-ext") || "";
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(ticket) || !/^[a-z]{32}$/.test(extensionId)) {
    return;
  }
  chrome.runtime.sendMessage(
    extensionId,
    { type: "CLAIM_OAUTH_TICKET", ticket },
    function () {
      void chrome.runtime.lastError;
    },
  );
})();
