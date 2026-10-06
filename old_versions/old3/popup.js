document.getElementById("open").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_RECORDER" });
  window.close();
});
