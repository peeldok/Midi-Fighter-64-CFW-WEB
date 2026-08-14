window.MF64_CONFIG = {
  githubUrl: "https://github.com/peeldok/Midi-Fighter-64-CFW",
  madeWithName: "PeelDok",

  originalFirmwareUrl: "./out.hex",
  cfwFirmwareUrl: "",

  dfuVendorId: 0x03EB,
  dfuProductId: 0x2FF4,
  flashSize: 0x8000,
  bootloaderStart: 0x7000,
  flashPageSize: 128
};

const mf64FirmwareResetScript = document.createElement("script");
mf64FirmwareResetScript.src = "firmware-reset.js";
document.body.appendChild(mf64FirmwareResetScript);
