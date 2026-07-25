import { extractArticleText } from "./extract";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "extract") {
    sendResponse(extractArticleText());
  }
  return false;
});
