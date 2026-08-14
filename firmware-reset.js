(() => {
  const status = document.getElementById("firmwareUpdateStatus");
  const updateButton = document.getElementById("firmwareUpdateButton");
  const fileInput = document.getElementById("firmwareHexFile");
  const selectedName = document.getElementById("selectedHexName");
  const custom = document.querySelector('input[name="firmwareSource"][value="custom"]');
  const original = document.querySelector('input[name="firmwareSource"][value="original"]');

  if (!status || !updateButton || !fileInput || !selectedName || !custom || !original) return;

  let updateWasCustom = false;
  let needsFreshSelection = false;

  updateButton.addEventListener("click", () => {
    updateWasCustom = custom.checked;
  }, true);

  function resetCustomSelection() {
    if (!updateWasCustom) return;

    updateWasCustom = false;
    needsFreshSelection = true;
    fileInput.value = "";
    selectedName.textContent = "Choose a local .hex file";
    original.checked = true;
    custom.checked = false;
  }

  const observer = new MutationObserver(() => {
    if (status.dataset.state === "ok" && status.textContent.trim() === "Update complete.") {
      resetCustomSelection();
    }
  });

  observer.observe(status, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-state"]
  });

  custom.addEventListener("click", () => {
    if (!needsFreshSelection) return;
    setTimeout(() => fileInput.click(), 0);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) needsFreshSelection = false;
  }, true);
})();
